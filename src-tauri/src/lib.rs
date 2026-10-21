use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::OnceLock;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tokio::sync::Mutex;

// CREATE_NO_WINDOW: evita el parpadeo de la consola al lanzar winget.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const LIST_TIMEOUT: Duration = Duration::from_secs(90);
const ACTION_TIMEOUT: Duration = Duration::from_secs(1800);
const SHOW_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_SIZE_LOOKUPS: usize = 25;

// ==== Modelos ====

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct App {
    pub id: String,
    pub name: String,
    pub version: String,
    pub available: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct IgnoredApp {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HistoryEntry {
    pub id: String,
    pub name: String,
    pub from_version: String,
    pub to_version: String,
    pub date: String,
}

#[derive(Clone, Serialize)]
pub struct ProgressEvent {
    pub stage: String,
    pub label: String,
    pub percent: u8,
}

#[derive(Serialize)]
pub struct AppInfo {
    pub version: String,
    pub winget_version: Option<String>,
}

// ==== Persistencia ====

fn data_dir() -> PathBuf {
    let mut path = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("SuperUpdater");
    fs::create_dir_all(&path).ok();
    path
}

fn history_path() -> PathBuf {
    data_dir().join("history.json")
}

fn ignored_path() -> PathBuf {
    data_dir().join("ignored.json")
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &PathBuf) -> Vec<T> {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Escritura atómica: evita corromper el historial si la app se cierra a mitad.
fn write_json<T: Serialize>(path: &PathBuf, data: &[T]) {
    if let Ok(json) = serde_json::to_string_pretty(data) {
        let tmp = path.with_extension("json.tmp");
        if fs::write(&tmp, json).is_ok() {
            let _ = fs::rename(&tmp, path);
        }
    }
}

// ==== Codificación ====

/// Decodifica la salida de winget. winget escribe en UTF-8 cuando stdout no es
/// una consola, pero en versiones antiguas usa la página de códigos del sistema
/// (CP1252 en Windows en español). Intentamos UTF-8 y caemos a CP1252.
fn decode(bytes: Vec<u8>) -> String {
    match String::from_utf8(bytes) {
        Ok(s) => s,
        Err(e) => {
            let raw = e.into_bytes();
            let mut out = String::with_capacity(raw.len());
            for b in raw {
                match b {
                    0x00..=0x7F => out.push(b as char),
                    0xA0..=0xFF => out.push(b as char),
                    0x80 => out.push('\u{20AC}'),
                    0x82 => out.push('\u{201A}'),
                    0x83 => out.push('\u{0192}'),
                    0x84 => out.push('\u{201E}'),
                    0x85 => out.push('\u{2026}'),
                    0x86 => out.push('\u{2020}'),
                    0x87 => out.push('\u{2021}'),
                    0x88 => out.push('\u{02C6}'),
                    0x89 => out.push('\u{2030}'),
                    0x8A => out.push('\u{0160}'),
                    0x8B => out.push('\u{2039}'),
                    0x8C => out.push('\u{0152}'),
                    0x8E => out.push('\u{017D}'),
                    0x91 => out.push('\u{2018}'),
                    0x92 => out.push('\u{2019}'),
                    0x93 => out.push('\u{201C}'),
                    0x94 => out.push('\u{201D}'),
                    0x95 => out.push('\u{2022}'),
                    0x96 => out.push('\u{2013}'),
                    0x97 => out.push('\u{2014}'),
                    0x98 => out.push('\u{02DC}'),
                    0x99 => out.push('\u{2122}'),
                    0x9A => out.push('\u{0161}'),
                    0x9B => out.push('\u{203A}'),
                    0x9C => out.push('\u{0153}'),
                    0x9E => out.push('\u{017E}'),
                    0x9F => out.push('\u{0178}'),
                    _ => out.push('\u{FFFD}'),
                }
            }
            out
        }
    }
}

/// Quita secuencias de escape ANSI que winget puede emitir al detectar consola.
fn strip_ansi(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1B}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for c2 in chars.by_ref() {
                    if c2.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

// ==== winget ====

/// Localiza el ejecutable de winget.
fn winget_exe() -> PathBuf {
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let p = PathBuf::from(local)
            .join("Microsoft")
            .join("WindowsApps")
            .join("winget.exe");
        if p.exists() {
            return p;
        }
    }
    PathBuf::from("winget")
}

/// Los identificadores de winget sólo pueden contener estos caracteres.
/// Evita que un id malicioso se inyecte como argumento (p. ej. `--version`).
fn sanitize_id(id: &str) -> Result<String, String> {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return Err("El identificador está vacío".to_string());
    }
    if !is_valid_package_id(trimmed) {
        return Err(format!("Identificador no válido: {}", trimmed));
    }
    Ok(trimmed.to_string())
}

/// Serializa las operaciones de winget. winget no tolera bien dos instancias
/// simultáneas (bloquea los acuerdos de origen y falla con errores confusos).
static WINGET_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn winget_lock() -> &'static Mutex<()> {
    WINGET_LOCK.get_or_init(|| Mutex::new(()))
}

enum Line {
    Out(String),
    Err(String),
}

fn spawn_winget(args: &[&str]) -> Result<std::process::Child, String> {
    let exe = winget_exe();
    let mut cmd = Command::new(&exe);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW);
    cmd.spawn().map_err(|e| {
        format!(
            "No se pudo ejecutar winget ({}): {}",
            exe.display(),
            e
        )
    })
}

/// Ejecuta winget y devuelve su salida por stdout.
///
/// `on_line` recibe cada línea en tiempo real, lo que permite emitir eventos de
/// progreso mientras winget trabaja en lugar de mostrarlos todos al final.
fn run_winget_streaming<F: FnMut(&str)>(
    args: &[&str],
    timeout: Duration,
    mut on_line: F,
) -> Result<String, String> {
    let mut child = spawn_winget(args)?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let (tx, rx) = mpsc::channel::<Line>();

    if let Some(out) = stdout {
        let tx = tx.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                if tx.send(Line::Out(line)).is_err() {
                    break;
                }
            }
        });
    }
    if let Some(err) = stderr {
        let tx = tx.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                if tx.send(Line::Err(line)).is_err() {
                    break;
                }
            }
        });
    }
    // El original se suelta: el canal se cierra cuando terminan ambos lectores.
    drop(tx);

    let deadline = Instant::now() + timeout;
    let mut stdout_buf = String::new();
    let mut stderr_buf = String::new();

    loop {
        match rx.recv_timeout(Duration::from_millis(150)) {
            Ok(Line::Out(line)) => {
                let line = strip_ansi(&line);
                stdout_buf.push_str(&line);
                stdout_buf.push('\n');
                on_line(&line);
            }
            Ok(Line::Err(line)) => {
                let line = strip_ansi(&line);
                stderr_buf.push_str(&line);
                stderr_buf.push('\n');
            }
            Err(RecvTimeoutError::Timeout) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!(
                        "winget tardó más de {} segundos y se canceló. Inténtalo de nuevo.",
                        timeout.as_secs()
                    ));
                }
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("Error esperando a winget: {}", e))?;

    if !status.success() {
        return Err(extract_error(&stdout_buf, &stderr_buf));
    }

    Ok(stdout_buf)
}

fn run_winget(args: &[&str], timeout: Duration) -> Result<String, String> {
    run_winget_streaming(args, timeout, |_| {})
}

fn meaningful_lines(text: &str) -> Vec<String> {
    text.lines()
        .map(|l| l.trim().to_string())
        .filter(|l| {
            !l.is_empty()
                && !l.chars()
                    .all(|c| matches!(c, '-' | '\\' | '/' | '|' | '=' | ' '))
        })
        .collect()
}

fn looks_like_error(line: &str) -> bool {
    let low = line.to_lowercase();
    low.contains("error")
        || low.contains("failed")
        || low.contains("fail ")
        || low.contains("exit code")
        || low.contains("código de salida")
        || low.contains("codigo de salida")
        || low.contains("0x8")
        || low.contains("denied")
        || low.contains("cancel")
        || low.contains("requiere")
        || low.contains("no se pudo")
}

/// Extrae un mensaje de error útil de la salida de winget.
fn extract_error(stdout: &str, stderr: &str) -> String {
    let err_lines = meaningful_lines(stderr);
    let out_lines = meaningful_lines(stdout);

    let pick = err_lines
        .iter()
        .rev()
        .find(|l| looks_like_error(l))
        .or_else(|| out_lines.iter().rev().find(|l| looks_like_error(l)))
        .or_else(|| err_lines.last())
        .or_else(|| out_lines.last());

    match pick {
        Some(line) => {
            let cleaned: String = line.split_whitespace().collect::<Vec<_>>().join(" ");
            if cleaned.len() > 300 {
                format!("{}…", &cleaned[..300])
            } else {
                cleaned
            }
        }
        None => "La operación falló sin detalles. Vuelve a intentarlo.".to_string(),
    }
}

// ==== Parseo de la tabla de winget ====

/// Normaliza un encabezado: minúsculas, sin acentos y sin espacios extra.
fn normalize_header(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.trim().to_lowercase().chars() {
        match c {
            'á' | 'à' | 'ä' | 'â' => out.push('a'),
            'é' | 'è' | 'ë' | 'ê' => out.push('e'),
            'í' | 'ì' | 'ï' | 'î' => out.push('i'),
            'ó' | 'ò' | 'ö' | 'ô' => out.push('o'),
            'ú' | 'ù' | 'ü' | 'û' => out.push('u'),
            'ñ' => out.push('n'),
            'ç' => out.push('c'),
            _ => out.push(c),
        }
    }
    out.trim().to_string()
}

/// Divide una fila en celdas junto con el desplazamiento de inicio de cada una.
///
/// winget separa las columnas con dos o más espacios. Un único espacio NO
/// separa columnas: es lo que mantiene juntas cabeceras como "Installer Url"
/// y valores como `ARP\Machine\X64\Android Studio`.
fn split_cells(line: &str) -> Vec<(usize, String)> {
    let mut cells: Vec<(usize, String)> = Vec::new();
    let mut cur = String::new();
    let mut cur_start = 0usize;
    let mut gap = 0usize;

    for (i, c) in line.chars().enumerate() {
        if c == ' ' {
            gap += 1;
            continue;
        }
        if gap >= 2 {
            // Dos o más espacios: cambia de columna.
            if !cur.is_empty() {
                cells.push((cur_start, std::mem::take(&mut cur)));
            }
            cur_start = i;
        } else if gap == 1 && !cur.is_empty() {
            // Un único espacio: es interno a la celda.
            cur.push(' ');
        } else if cur.is_empty() {
            cur_start = i;
        }
        gap = 0;
        cur.push(c);
    }
    if !cur.is_empty() {
        cells.push((cur_start, cur.trim_end().to_string()));
    }
    cells
}

/// Extrae el texto de una celda usando las posiciones del encabezado.
fn cell(line: &[char], start: usize, end: Option<usize>) -> String {
    if start >= line.len() {
        return String::new();
    }
    let e = end.unwrap_or(line.len()).min(line.len());
    if e <= start {
        return String::new();
    }
    line[start..e].iter().collect::<String>().trim().to_string()
}

/// ¿El identificador tiene forma de paquete de winget?
///
/// Los ids normales (`7zip.7zip`) no llevan espacios. Los únicos que sí
/// llevan son los registros ARP (`ARP\User\X64\...`) y MSIX (`MSIX\...`).
/// Esto descarta las líneas de resumen de winget ("18 actualizaciones
/// disponibles.") cuando caben dentro de la columna del identificador.
fn looks_like_package_id(id: &str) -> bool {
    let id = id.trim();
    if id.is_empty() {
        return false;
    }
    if !id.contains(' ') {
        return true;
    }
    // Los ids con espacios sólo existen en los registros ARP/MSIX, que llevan
    // barra invertida. Un texto como "18 actualizaciones disponibles." no.
    id.contains('\\')
}

struct ColumnMap {
    name: Option<usize>,
    id: Option<usize>,
    version: Option<usize>,
    available: Option<usize>,
}

fn map_columns(headers: &[String]) -> ColumnMap {
    let find = |pred: &dyn Fn(&str) -> bool| -> Option<usize> {
        headers.iter().position(|h| pred(&normalize_header(h)))
    };

    let name = find(&|h| h == "name" || h == "nombre" || h == "paquete" || h.starts_with("name "));
    let id = find(&|h| h == "id" || h == "identificador" || h == "package identifier");
    let version = find(&|h| h == "version" || h.starts_with("version "));
    // Sin columna "Available" (p. ej. `winget search`) no hay versión nueva.
    let available = find(&|h| h.contains("available") || h.contains("disponible"));

    ColumnMap { name, id, version, available }
}

/// Un identificador de paquete de winget sólo admite estos caracteres.
/// `winget list` también devuelve identificadores ARP/MSIX con espacios y
/// barras invertidas (`ARP\Machine\X64\Android Studio`), así que esta regla
/// sólo se aplica a los ids que se pasan como argumento a winget.
fn is_valid_package_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 120
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '+'))
}

/// Parsea la tabla tabular que devuelve winget.
///
/// winget imprime una tabla de ancho fijo: cada columna ocupa una posición
/// fija que viene del encabezado, y los valores se alinean a esa posición.
/// Por eso las celdas se extraen *por posición* y no partiendo la fila por
/// espacios: hay columnas separadas por un único espacio (por ejemplo
/// "13.796.0.6309 13.809.0.6322 winget") y valores con espacios dentro
/// (`ARP\Machine\X64\Android Studio`).
///
/// Los encabezados se detectan por nombre, así que funciona igual con winget
/// en español que en inglés.
fn parse_winget_table(output: &str) -> Vec<App> {
    let text = strip_ansi(output);
    let lines: Vec<&str> = text
        .split('\n')
        .map(|l| l.trim_end_matches('\r'))
        .collect();

    // Localiza la línea separadora (guiones) que sigue al encabezado.
    let sep_idx = lines
        .iter()
        .position(|l| {
            let t = l.trim();
            !t.is_empty()
                && t.len() >= 3
                && t.chars().all(|c| c == '-' || c == ' ')
        });

    let sep_idx = match sep_idx {
        Some(i) => i,
        None => return Vec::new(),
    };
    if sep_idx == 0 {
        return Vec::new();
    }

    let header_cells = split_cells(lines[sep_idx - 1]);
    if header_cells.len() < 2 {
        return Vec::new();
    }
    let starts: Vec<usize> = header_cells.iter().map(|(o, _)| *o).collect();
    let headers: Vec<String> = header_cells.iter().map(|(_, t)| t.clone()).collect();

    let map = map_columns(&headers);

    // Sin encabezados reconocidos se asume el orden habitual de winget:
    // Name, Id, Version, Available, Source. "Available" no tiene respaldo
    // posicional: si no aparece en la cabecera, no existe.
    let name_idx = map.name.or(Some(0));
    let id_idx = map.id.or(Some(1));
    let version_idx = map.version.or(Some(2));
    let available_idx = map.available;

    let mut apps: Vec<App> = Vec::new();

    for line in lines.iter().skip(sep_idx + 1) {
        if line.trim().is_empty() {
            continue;
        }
        let chars: Vec<char> = line.chars().collect();

        let get = |idx: Option<usize>| -> String {
            match idx {
                Some(i) if i < starts.len() => {
                    let end = starts.get(i + 1).copied();
                    cell(&chars, starts[i], end)
                }
                _ => String::new(),
            }
        };

        let name = get(name_idx);
        let id = get(id_idx);
        let version = get(version_idx);
        let available = get(available_idx);

        // Una fila real tiene identificador. Si no hay identificador *ni*
        // versión, la tabla ha terminado: aquí es donde winget escribe el
        // resumen ("16 actualizaciones disponibles.").
        if id.is_empty() && version.is_empty() && available.is_empty() {
            break;
        }
        // Un identificador con espacios y sin barra invertida no es un id de
        // paquete. La fila se descarta, pero NO se aborta la tabla: una sola
        // fila rara no debe hacer que desaparezcan las siguientes.
        if !looks_like_package_id(&id) {
            continue;
        }

        apps.push(App {
            name: if name.is_empty() { id.clone() } else { name },
            id,
            version,
            available,
        });
    }

    apps
}

// ==== Fecha/hora ====

/// Fecha y hora UTC en ISO 8601. El frontend la formatea con `Intl`, así que
/// se muestra en la zona horaria y el idioma del usuario.
fn iso_utc_now() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y,
        m,
        d,
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// Conversión de días desde 1970-01-01 a fecha civil (algoritmo de Hinnant).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

// ==== Comandos ====

#[tauri::command]
async fn check_winget() -> bool {
    let _guard = winget_lock().lock().await;
    tokio::task::spawn_blocking(|| {
        run_winget(&["--version"], Duration::from_secs(15)).is_ok()
    })
    .await
    .unwrap_or(false)
}

#[tauri::command]
async fn get_app_info() -> AppInfo {
    let version = env!("CARGO_PKG_VERSION").to_string();
    let _guard = winget_lock().lock().await;
    let winget_version = tokio::task::spawn_blocking(|| {
        run_winget(&["--version"], Duration::from_secs(15))
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    })
    .await
    .unwrap_or(None);
    AppInfo { version, winget_version }
}

#[tauri::command]
async fn install_winget() -> Result<String, String> {
    tokio::task::spawn_blocking(|| {
        let script = r#"
$ErrorActionPreference = 'Stop'
$url = 'https://aka.ms/getwinget'
$tmp = Join-Path $env:TEMP 'winget.msixbundle'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -Uri $url -OutFile $tmp
Add-AppxPackage -Path $tmp
Remove-Item $tmp -ErrorAction SilentlyContinue
"#;
        let output = Command::new("powershell")
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| e.to_string())?;

        if output.status.success() {
            Ok("winget instalado correctamente".to_string())
        } else {
            let err = decode(output.stderr);
            let out = decode(output.stdout);
            Err(extract_error(&out, &err))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn list_upgrades() -> Result<Vec<App>, String> {
    let _guard = winget_lock().lock().await;
    let output = tokio::task::spawn_blocking(|| {
        run_winget(
            &[
                "upgrade",
                "--include-unknown",
                "--disable-interactivity",
                "--accept-source-agreements",
            ],
            LIST_TIMEOUT,
        )
    })
    .await
    .map_err(|e| e.to_string())??;

    let ignored: Vec<IgnoredApp> = read_json(&ignored_path());
    Ok(parse_winget_table(&output)
        .into_iter()
        .filter(|a| !ignored.iter().any(|i| i.id.eq_ignore_ascii_case(&a.id)))
        .collect())
}

#[tauri::command]
async fn list_installed() -> Result<Vec<App>, String> {
    let _guard = winget_lock().lock().await;
    let output = tokio::task::spawn_blocking(|| {
        run_winget(
            &[
                "list",
                "--disable-interactivity",
                "--accept-source-agreements",
            ],
            LIST_TIMEOUT,
        )
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(parse_winget_table(&output))
}

#[tauri::command]
async fn search_apps(query: String) -> Result<Vec<App>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let _guard = winget_lock().lock().await;
    let query = query.to_string();
    let output = tokio::task::spawn_blocking(move || {
        run_winget(
            &[
                "search",
                &query,
                "--disable-interactivity",
                "--accept-source-agreements",
            ],
            LIST_TIMEOUT,
        )
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(parse_winget_table(&output))
}

#[tauri::command]
async fn upgrade_app(
    app: tauri::AppHandle,
    id: String,
    name: String,
    from_version: String,
    to_version: String,
) -> Result<String, String> {
    let id = sanitize_id(&id)?;
    let _guard = winget_lock().lock().await;

    let handle = app.clone();
    let label = name.clone();
    let cmd_id = id.clone();
    let result = tokio::task::spawn_blocking(move || {
        let _ = handle.emit(
            "progress",
            ProgressEvent {
                stage: "downloading".to_string(),
                label: label.clone(),
                percent: 5,
            },
        );

        let mut last_stage = String::new();
        let h2 = handle.clone();
        let l2 = label.clone();
        let output = run_winget_streaming(
            &[
                "upgrade",
                "--id",
                &cmd_id,
                "--exact",
                "--silent",
                "--accept-package-agreements",
                "--accept-source-agreements",
                "--disable-interactivity",
            ],
            ACTION_TIMEOUT,
            move |line| {
                let low = line.to_lowercase();
                let (stage, percent) = if low.contains("download")
                    || low.contains("descargando")
                    || low.contains("downloading")
                {
                    ("downloading", 30u8)
                } else if low.contains("verif")
                    || low.contains("hash")
                    || low.contains("verificando")
                {
                    ("verifying", 60u8)
                } else if low.contains("install")
                    || low.contains("instalando")
                    || low.contains("upgrad")
                    || low.contains("actualizando")
                {
                    ("installing", 80u8)
                } else if low.contains("complet")
                    || low.contains("success")
                    || low.contains("correctamente")
                {
                    ("installing", 95u8)
                } else {
                    return;
                };
                if stage != last_stage {
                    last_stage = stage.to_string();
                    let _ = h2.emit(
                        "progress",
                        ProgressEvent {
                            stage: stage.to_string(),
                            label: l2.clone(),
                            percent,
                        },
                    );
                }
            },
        )?;

        Ok::<String, String>(output)
    })
    .await
    .map_err(|e| e.to_string())?;

    match &result {
        Ok(_) => {
            let _ = app.emit(
                "progress",
                ProgressEvent {
                    stage: "done".to_string(),
                    label: name.clone(),
                    percent: 100,
                },
            );
            let path = history_path();
            let mut history: Vec<HistoryEntry> = read_json(&path);
            history.insert(
                0,
                HistoryEntry {
                    id,
                    name,
                    from_version,
                    to_version,
                    date: iso_utc_now(),
                },
            );
            history.truncate(100);
            write_json(&path, &history);
        }
        Err(_) => {
            let _ = app.emit(
                "progress",
                ProgressEvent {
                    stage: "error".to_string(),
                    label: name.clone(),
                    percent: 0,
                },
            );
        }
    }

    result.map(|o| {
        meaningful_lines(&o)
            .last()
            .cloned()
            .unwrap_or_else(|| "ok".to_string())
    })
}

#[tauri::command]
async fn uninstall_app(id: String) -> Result<String, String> {
    let id = sanitize_id(&id)?;
    let _guard = winget_lock().lock().await;
    tokio::task::spawn_blocking(move || {
        run_winget(
            &[
                "uninstall",
                "--id",
                &id,
                "--exact",
                "--silent",
                "--disable-interactivity",
                "--accept-source-agreements",
            ],
            ACTION_TIMEOUT,
        )?;
        Ok::<String, String>("ok".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn repair_app(id: String) -> Result<String, String> {
    let id = sanitize_id(&id)?;
    let _guard = winget_lock().lock().await;
    tokio::task::spawn_blocking(move || {
        run_winget(
            &[
                "repair",
                "--id",
                &id,
                "--exact",
                "--silent",
                "--disable-interactivity",
                "--accept-source-agreements",
            ],
            ACTION_TIMEOUT,
        )?;
        Ok::<String, String>("ok".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn install_app(id: String) -> Result<String, String> {
    let id = sanitize_id(&id)?;
    let _guard = winget_lock().lock().await;
    tokio::task::spawn_blocking(move || {
        run_winget(
            &[
                "install",
                "--id",
                &id,
                "--exact",
                "--silent",
                "--accept-package-agreements",
                "--accept-source-agreements",
                "--disable-interactivity",
            ],
            ACTION_TIMEOUT,
        )?;
        Ok::<String, String>("ok".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Tamaños de descarga para varios paquetes.
///
/// Se resuelve en una sola llamada (antes el frontend hacía una invocación por
/// app, y cada una lanzaba un proceso de PowerShell + winget + una petición
/// HTTP: eso saturaba el equipo y bloqueaba la interfaz).
#[tauri::command]
async fn get_package_sizes(ids: Vec<String>) -> Result<HashMap<String, String>, String> {
    let ids: Vec<String> = ids
        .into_iter()
        .filter_map(|id| sanitize_id(&id).ok())
        .take(MAX_SIZE_LOOKUPS)
        .collect();
    if ids.is_empty() {
        return Ok(HashMap::new());
    }

    let _guard = winget_lock().lock().await;
    tokio::task::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(5))
            .user_agent("SuperUpdater")
            .build()
            .map_err(|e| e.to_string())?;

        let mut sizes = HashMap::new();
        for id in &ids {
            let show = match run_winget(&["show", "--id", id, "--exact"], SHOW_TIMEOUT) {
                Ok(s) => s,
                Err(_) => continue,
            };
            let url = find_installer_url(&show);
            let url = match url {
                Some(u) => u,
                None => continue,
            };
            let size = client
                .head(&url)
                .send()
                .ok()
                .and_then(|r| {
                    r.headers()
                        .get("content-length")?
                        .to_str().ok()?
                        .parse::<u64>().ok()
                });
            if let Some(b) = size {
                sizes.insert(id.clone(), format_size(b));
            }
        }
        Ok::<HashMap<String, String>, String>(sizes)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn find_installer_url(text: &str) -> Option<String> {
    for line in text.lines() {
        let low = line.to_lowercase();
        if low.contains("installer url") || low.contains("url del instalador") {
            if let Some((_, value)) = line.split_once(':') {
                let v = value.trim();
                if v.starts_with("http") {
                    return Some(v.to_string());
                }
            }
        }
    }
    None
}

fn format_size(bytes: u64) -> String {
    if bytes > 1_048_576 {
        format!("{:.1} MB", bytes as f64 / 1_048_576.0)
    } else if bytes > 1024 {
        format!("{:.0} KB", bytes as f64 / 1024.0)
    } else {
        format!("{} B", bytes)
    }
}

// ==== Historial ====

#[tauri::command]
async fn get_history() -> Vec<HistoryEntry> {
    read_json(&history_path())
}

#[tauri::command]
async fn clear_history() {
    write_json(&history_path(), &Vec::<HistoryEntry>::new());
}

// ==== Ignorados ====

#[tauri::command]
async fn get_ignored() -> Vec<IgnoredApp> {
    read_json(&ignored_path())
}

#[tauri::command]
async fn ignore_app(id: String, name: String) -> Vec<IgnoredApp> {
    let path = ignored_path();
    let mut ignored: Vec<IgnoredApp> = read_json(&path);
    if !ignored.iter().any(|a| a.id == id) {
        ignored.push(IgnoredApp { id, name });
    }
    write_json(&path, &ignored);
    ignored
}

#[tauri::command]
async fn unignore_app(id: String) -> Vec<IgnoredApp> {
    let path = ignored_path();
    let mut ignored: Vec<IgnoredApp> = read_json(&path);
    ignored.retain(|a| a.id != id);
    write_json(&path, &ignored);
    ignored
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            check_winget, get_app_info, install_winget,
            list_upgrades, upgrade_app,
            list_installed, uninstall_app, repair_app,
            get_history, clear_history,
            get_ignored, ignore_app, unignore_app,
            search_apps, install_app,
            get_package_sizes
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ==== Pruebas ====

#[cfg(test)]
mod tests {
    use super::*;

    const UPGRADE_ES: &str = include_str!("../tests/fixtures/upgrade_es.txt");
    const UPGRADE_ES_FULL: &str = include_str!("../tests/fixtures/upgrade_es_full.txt");
    const UPGRADE_EN: &str = include_str!("../tests/fixtures/upgrade_en.txt");
    const LIST_ES: &str = include_str!("../tests/fixtures/list_es.txt");
    const SEARCH_ES: &str = include_str!("../tests/fixtures/search_es.txt");

    #[test]
    fn split_cells_separa_por_dos_espacios() {
        let cells = split_cells("Nombre  Id  Versión");
        assert_eq!(cells.len(), 3);
        assert_eq!(cells[0], (0, "Nombre".to_string()));
        assert_eq!(cells[1], (8, "Id".to_string()));
        assert_eq!(cells[2], (12, "Versión".to_string()));
    }

    #[test]
    fn split_cells_mantiene_juntas_las_cabeceras_con_espacio() {
        // "Installer Url" es una sola columna, no dos.
        let cells = split_cells("Name    Id    Installer Url    Source");
        assert_eq!(cells.len(), 4);
        assert_eq!(cells[2].1, "Installer Url");
    }

    #[test]
    fn split_cells_conserva_espacios_internos() {
        // Identificadores ARP de `winget list` contienen espacios y barras.
        let cells = split_cells("Android Studio    ARP\\Machine\\X64\\Android Studio    2025.3");
        assert_eq!(cells.len(), 3);
        assert_eq!(cells[1].1, "ARP\\Machine\\X64\\Android Studio");
    }

    #[test]
    fn upgrade_en_espanol_ignora_la_linea_de_resumen() {
        let apps = parse_winget_table(UPGRADE_ES);
        assert_eq!(apps.len(), 4, "esperaba 4 apps: {:?}", apps);

        let claude = &apps[0];
        assert_eq!(claude.name, "Claude");
        assert_eq!(claude.id, "Anthropic.Claude");
        assert_eq!(claude.version, "1.15200.0.0");
        assert_eq!(claude.available, "2.42304.2");

        // La línea final ("18 actualizaciones disponibles.") no es una app.
        assert!(!apps.iter().any(|a| a.id.contains("actualizaciones")));
    }

    #[test]
    fn upgrade_en_espanol_parte_nombres_largos() {
        let apps = parse_winget_table(UPGRADE_ES);
        let asp = apps
            .iter()
            .find(|a| a.id == "Microsoft.DotNet.AspNetCore.8")
            .expect("falta ASP.NET Core");
        assert_eq!(asp.name, "Microsoft ASP.NET Core 8.0.31 - Shared Framework (x64)");
        assert_eq!(asp.version, "8.0.31");
        assert_eq!(asp.available, "8.0.32");
    }

    #[test]
    fn list_en_espanol_salta_columna_disponible_vacia() {
        let apps = parse_winget_table(LIST_ES);
        assert_eq!(apps.len(), 3, "esperaba 3 apps: {:?}", apps);

        let zip = &apps[0];
        assert_eq!(zip.name, "7-Zip 26.04 (x64)");
        assert_eq!(zip.id, "7zip.7zip");
        assert_eq!(zip.version, "26.04");
        // "winget" es el origen, no la versión disponible.
        assert_eq!(zip.available, "");
    }

    #[test]
    fn list_en_espanol_conserva_ids_largos_msix() {
        let apps = parse_winget_table(LIST_ES);
        let msix = apps
            .iter()
            .find(|a| a.name == "Xbox Game Speech Window")
            .expect("falta la app MSIX");
        assert_eq!(
            msix.id,
            "MSIX\\Microsoft.XboxSpeechToTextOverlay_1.21.13002.0_x64__8wekyb3d8bbwe"
        );
        assert_eq!(msix.version, "1.21.13002.0");
    }

    #[test]
    fn list_en_espanol_conserva_ids_arp_con_espacios() {
        let apps = parse_winget_table(LIST_ES);
        let arp = apps
            .iter()
            .find(|a| a.name == "XML Studio")
            .expect("falta la app ARP");
        assert_eq!(arp.id, "ARP\\User\\X64\\XML Studio");
        assert_eq!(arp.version, "1.0.0");
    }

    #[test]
    fn search_no_toma_la_columna_coincidencia_como_version() {
        let apps = parse_winget_table(SEARCH_ES);
        assert_eq!(apps.len(), 7, "esperaba 7 resultados: {:?}", apps);

        let vlc = &apps[1];
        assert_eq!(vlc.name, "VLC media player");
        assert_eq!(vlc.id, "VideoLAN.VLC");
        assert_eq!(vlc.version, "3.0.24");
        // `winget search` no ofrece columna de versión disponible.
        assert_eq!(vlc.available, "");

        let pym = &apps[2];
        assert_eq!(pym.id, "Cimbali.pympress");
        assert_eq!(pym.version, "1.8.6");
    }

    #[test]
    fn upgrade_completo_no_pierde_filas() {
        // Salida real completa de `winget upgrade` (18 filas).
        let apps = parse_winget_table(UPGRADE_ES_FULL);
        assert_eq!(apps.len(), 18, "faltan filas: {:?}", apps);
        // El número de filas debe coincidir con el que declara el propio
        // winget al final de la salida.
        assert_eq!(
            reported_count(UPGRADE_ES_FULL),
            Some(apps.len()),
            "el parser no coincide con el resumen de winget"
        );
        for app in &apps {
            assert!(!app.id.is_empty(), "fila sin id: {:?}", app);
            assert!(!app.version.is_empty(), "fila sin versión: {:?}", app);
            assert!(!app.available.is_empty(), "fila sin versión disponible: {:?}", app);
        }
        // Ningún id debe contener restos de otra columna.
        for app in &apps {
            assert!(!app.id.contains(' '), "id con espacios: {:?}", app);
            assert!(!app.id.contains("winget"), "id con el origen dentro: {:?}", app);
        }
    }

    /// Prueba de diagnóstico contra el winget real del sistema.
    /// No forma parte de la suite normal: requiere winget instalado.
    #[test]
    #[ignore = "requiere winget instalado"]
    fn diagnostico_winget_real() {
        let out = run_winget(
            &[
                "upgrade",
                "--include-unknown",
                "--disable-interactivity",
                "--accept-source-agreements",
            ],
            LIST_TIMEOUT,
        )
        .expect("winget falló");
        let apps = parse_winget_table(&out);
        println!("--- filas parseadas: {} ---", apps.len());
        for a in &apps {
            println!(
                "nom={:?} id={:?} ver={:?} disp={:?}",
                a.name, a.id, a.version, a.available
            );
        }
        // Se compara con el número que el propio winget declara al final de la
        // salida, no con un número fijo: el conjunto de actualizaciones del
        // equipo cambia con cada actualización aplicada.
        let reported = reported_count(&out).expect("no se encontró el resumen de winget");
        println!("--- winget declara: {} ---", reported);
        assert_eq!(
            apps.len(),
            reported,
            "el parser debe devolver las mismas filas que declara winget"
        );
    }

    /// Extrae el número de actualizaciones que declara winget al final de su
    /// salida ("16 actualizaciones disponibles." / "16 upgrades are available.").
    fn reported_count(output: &str) -> Option<usize> {
        output
            .lines()
            .rev()
            .find_map(|l| {
                let t = l.trim();
                let first = t.split_whitespace().next()?;
                let n: usize = first.parse().ok()?;
                let lower = t.to_lowercase();
                if lower.contains("disponible")
                    || lower.contains("available")
                    || lower.contains("actualizaci")
                    || lower.contains("upgrade")
                {
                    Some(n)
                } else {
                    None
                }
            })
    }

    #[test]
    fn una_fila_rara_no_corta_la_tabla() {
        // La segunda fila tiene un id con espacios y sin barra invertida: no es
        // un paquete válido. Debe descartarse sola sin arrastrar a la tercera.
        let out = "Nombre      Id                     Versión     Disponible  Origen\r\n\
                   ----------------------------------------------------------------------\r\n\
                   Alpha       Alpha.Alpha             1.0.0       1.1.0       winget\r\n\
                   Beta        Beta Beta               2.0.0       2.1.0       winget\r\n\
                   Gamma       Gamma.Gamma             3.0.0       3.1.0       winget\r\n\
                   3 actualizaciones disponibles.\r\n";
        let apps = parse_winget_table(out);
        let ids: Vec<&str> = apps.iter().map(|a| a.id.as_str()).collect();
        assert_eq!(ids, vec!["Alpha.Alpha", "Gamma.Gamma"]);
    }

    #[test]
    fn upgrade_en_ingles_usa_las_mismas_columnas() {
        let apps = parse_winget_table(UPGRADE_EN);
        assert_eq!(apps.len(), 3, "esperaba 3 apps: {:?}", apps);

        let zip = &apps[0];
        assert_eq!(zip.name, "7-Zip 26.04 (x64)");
        assert_eq!(zip.id, "7zip.7zip");
        assert_eq!(zip.version, "26.04");
        assert_eq!(zip.available, "26.05");

        // "3 upgrades are available." no es una app.
        assert!(!apps.iter().any(|a| a.id.contains("upgrades")));
    }

    #[test]
    fn normaliza_encabezados_con_acentos() {
        assert_eq!(normalize_header("Versión"), "version");
        assert_eq!(normalize_header("Disponible"), "disponible");
        assert_eq!(normalize_header("Nombre"), "nombre");
    }

    #[test]
    fn detecta_columnas_en_espanol_e_ingles() {
        let es = map_columns(&["Nombre".into(), "Id".into(), "Versión".into(), "Disponible".into()]);
        assert_eq!(es.name, Some(0));
        assert_eq!(es.id, Some(1));
        assert_eq!(es.version, Some(2));
        assert_eq!(es.available, Some(3));

        let en = map_columns(&["Name".into(), "Id".into(), "Version".into(), "Available".into()]);
        assert_eq!(en.name, Some(0));
        assert_eq!(en.id, Some(1));
        assert_eq!(en.version, Some(2));
        assert_eq!(en.available, Some(3));
    }

    #[test]
    fn la_columna_coincidencia_no_es_disponible() {
        // En `winget search` la última columna es "Coincidencia Origen".
        let cols = map_columns(&[
            "Nombre".into(),
            "Id".into(),
            "Versión".into(),
            "Coincidencia Origen".into(),
        ]);
        assert_eq!(cols.available, None);
    }

    #[test]
    fn sanea_identificadores_para_pasarlos_a_winget() {
        assert!(sanitize_id("Anthropic.Claude").is_ok());
        assert!(sanitize_id("7zip.7zip").is_ok());
        assert!(sanitize_id("  Git.Git  ").is_ok());
        // Un id con espacios podría inyectar otro argumento en winget.
        assert!(sanitize_id("Git.Git --version").is_err());
        assert!(sanitize_id("").is_err());
        assert!(sanitize_id("ARP\\Machine\\X64\\Android Studio").is_err());
    }

    #[test]
    fn formatea_tamanos() {
        assert_eq!(format_size(512), "512 B");
        assert_eq!(format_size(2048), "2 KB");
        assert_eq!(format_size(5 * 1_048_576), "5.0 MB");
    }

    /// Vigila que los textos con cantidad pluralicen bien.
    ///
    /// El bug original construía el plural concatenando una letra:
    /// "actualización" + "es" -> "actualizaciónes", que en español es
    /// incorrecto (lo correcto es "actualizaciones"). Esta prueba
    /// comprueba el fichero de traducciones, ya que el JavaScript no tiene
    /// un runner de pruebas en este proyecto.
    #[test]
    fn los_textos_con_cantidad_usan_plural() {
        let i18n = include_str!("../../src/i18n.js");

        // La forma rota: pegar una letra al sustantivo.
        assert!(
            !i18n.contains("actualización${"),
            "el plural en español no se forma concatenando 'es'"
        );
        assert!(
            !i18n.contains("n === '1' ? '' : 's'"),
            "no se deben comparar cantidades como cadenas"
        );
        assert!(
            !i18n.contains("${n}</span> aplicaciones instaladas."),
            "la forma en plural debe elegirse con plural()"
        );

        // Las formas correctas, completas.
        assert!(i18n.contains("plural(n, 'actualización', 'actualizaciones')"));
        assert!(i18n.contains("plural(n, 'pendiente', 'pendientes')"));
        assert!(i18n.contains("plural(n, 'update', 'updates')"));
        assert!(i18n.contains(
            "plural(n, 'installed application', 'installed applications')"
        ));
        assert!(i18n.contains(
            "plural(n, 'aplicación instalada', 'aplicaciones instaladas')"
        ));

        // Las dos claves que dependen de una cantidad deben usar plural().
        for key in ["updates_pending", "installed_count"] {
            let line = i18n
                .lines()
                .find(|l| l.contains(key))
                .unwrap_or_else(|| panic!("falta la clave {}", key));
            assert!(line.contains("plural("), "{} no usa plural(): {}", key, line);
        }
    }
}
