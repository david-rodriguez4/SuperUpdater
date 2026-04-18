use std::os::windows::process::CommandExt;
use std::process::Command;
use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

#[derive(Serialize, Deserialize, Clone)]
pub struct App {
    pub id: String,
    pub name: String,
    pub version: String,
    pub available: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct IgnoredApp {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct HistoryEntry {
    pub id: String,
    pub name: String,
    pub from_version: String,
    pub to_version: String,
    pub date: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ProgressEvent {
    pub stage: String,
    pub label: String,
    pub percent: u8,
}

fn data_dir() -> PathBuf {
    let mut path = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("SuperUpdater");
    fs::create_dir_all(&path).ok();
    path
}

fn history_path() -> PathBuf { data_dir().join("history.json") }
fn ignored_path() -> PathBuf { data_dir().join("ignored.json") }

fn read_json<T: for<'de> Deserialize<'de>>(path: &PathBuf) -> Vec<T> {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_json<T: Serialize>(path: &PathBuf, data: &Vec<T>) {
    if let Ok(json) = serde_json::to_string_pretty(data) {
        fs::write(path, json).ok();
    }
}

fn run_winget(args: &[&str]) -> Result<String, String> {
    let mut cmd_str = String::from("winget");
    for arg in args {
        cmd_str.push(' ');
        cmd_str.push_str(arg);
    }

    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", &cmd_str])
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();

    if !output.status.success() {
        let error_line = stdout
            .split(|c| c == '\n' || c == '\r')
            .map(|l: &str| l.trim())
            .filter(|l| !l.is_empty() && !l.chars().all(|c| matches!(c, '-' | '\\' | '/' | '|' | ' ')))
            .last()
            .unwrap_or("Error desconocido")
            .to_string();
        return Err(error_line);
    }

    Ok(stdout)
}

fn parse_winget_table(output: &str) -> Vec<App> {
    let mut apps = Vec::new();
    let lines: Vec<&str> = output.split("\r\n").collect();

    let sep_idx = match lines.iter().position(|l| {
        let t = l.trim();
        !t.is_empty() && t.chars().all(|c| c == '-' || c == ' ')
    }) {
        Some(i) => i,
        None => return apps,
    };

    if sep_idx == 0 { return apps; }

    let raw_header = lines[sep_idx - 1];
    let header = raw_header.split('\r').last().unwrap_or(raw_header);
    let cols = get_column_positions(header);
    if cols.len() < 3 { return apps; }

    for line in lines.iter().skip(sep_idx + 1) {
        let clean = line.split('\r').last().unwrap_or(line);
        let chars: Vec<char> = clean.chars().collect();
        if chars.len() < cols[1] { continue; }

        let name = extract_col(&chars, cols[0], cols[1]).trim().to_string();
        let id = extract_col(&chars, cols[1], cols[2]).trim().to_string();
        let version = if cols.len() > 3 {
            extract_col(&chars, cols[2], cols[3]).trim().to_string()
        } else {
            extract_col(&chars, cols[2], chars.len()).trim().to_string()
        };
        let available = if cols.len() > 4 {
            extract_col(&chars, cols[3], cols[4]).trim().to_string()
        } else if cols.len() > 3 {
            extract_col(&chars, cols[3], chars.len()).trim().to_string()
        } else {
            String::new()
        };

        if !id.is_empty() && !version.is_empty() {
            apps.push(App { id, name, version, available });
        }
    }

    apps
}

fn get_column_positions(header: &str) -> Vec<usize> {
    let chars: Vec<char> = header.chars().collect();
    let mut positions = vec![0usize];
    let mut in_word = chars.first().map(|c| *c != ' ').unwrap_or(false);

    for (i, c) in chars.iter().enumerate().skip(1) {
        if *c != ' ' && !in_word {
            positions.push(i);
            in_word = true;
        } else if *c == ' ' {
            in_word = false;
        }
    }
    positions
}

fn extract_col(chars: &[char], start: usize, end: usize) -> String {
    let end = end.min(chars.len());
    if start >= end { return String::new(); }
    chars[start..end].iter().collect()
}

fn now_str() -> String {
    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", "Get-Date -Format 'yyyy-MM-dd HH:mm'"])
        .creation_flags(0x08000000)
        .output()
        .unwrap_or_else(|_| std::process::Output {
            status: std::process::ExitStatus::default(),
            stdout: vec![],
            stderr: vec![],
        });
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

// === Winget check / install ===

#[tauri::command]
fn check_winget() -> bool {
    Command::new("powershell")
        .args(["-NoProfile", "-Command", "winget --version"])
        .creation_flags(0x08000000)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[tauri::command]
async fn install_winget() -> Result<String, String> {
    tokio::task::spawn_blocking(|| {
        let script = r#"
$url = 'https://aka.ms/getwinget'
$tmp = "$env:TEMP\winget.msixbundle"
Invoke-WebRequest -Uri $url -OutFile $tmp
Add-AppxPackage -Path $tmp
"#;
        let output = Command::new("powershell")
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script])
            .creation_flags(0x08000000)
            .output()
            .map_err(|e| e.to_string())?;

        if output.status.success() {
            Ok("winget instalado correctamente".to_string())
        } else {
            let err = String::from_utf8_lossy(&output.stderr).to_string();
            Err(err.lines().last().unwrap_or("Error desconocido").to_string())
        }
    }).await.map_err(|e| e.to_string())?
}

// === Upgrades ===

#[tauri::command]
fn list_upgrades() -> Result<Vec<App>, String> {
    let ignored: Vec<IgnoredApp> = read_json(&ignored_path());
    let output = run_winget(&["upgrade", "--include-unknown", "--disable-interactivity"])?;
    let apps: Vec<App> = parse_winget_table(&output)
        .into_iter()
        .filter(|a| !ignored.iter().any(|i| i.id == a.id))
        .collect();
    Ok(apps)
}

#[tauri::command]
async fn upgrade_app(app: tauri::AppHandle, id: String, name: String, from_version: String, to_version: String) -> Result<String, String> {
    let emit = |stage: &str, label: &str, percent: u8| {
        let _ = app.emit("progress", ProgressEvent {
            stage: stage.to_string(),
            label: label.to_string(),
            percent,
        });
    };

    emit("downloading", &name, 10);

    let result = tokio::task::spawn_blocking({
        let id = id.clone();
        let name_clone = name.clone();
        let app2 = app.clone();
        move || {
            let cmd = format!(
                "winget upgrade --id '{}' --silent --accept-package-agreements --accept-source-agreements --disable-interactivity",
                id
            );
            let output = Command::new("powershell")
                .args(["-NoProfile", "-Command", &format!("{} 2>&1", cmd)])
                .creation_flags(0x08000000)
                .output()
                .map_err(|e| format!("No se pudo iniciar winget: {}", e))?;

            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let meaningful: Vec<String> = stdout
                .split(|c| c == '\r' || c == '\n')
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty() && !l.chars().all(|c| matches!(c, '-' | '\\' | '/' | '|' | ' ')))
                .collect();

            // Emit progress based on captured lines
            for line in &meaningful {
                let lower = line.to_lowercase();
                let (stage, percent) = if lower.contains("descargando") || lower.contains("downloading") {
                    ("downloading", 30u8)
                } else if lower.contains("verificando") || lower.contains("verifying") || lower.contains("hash") {
                    ("verifying", 60u8)
                } else if lower.contains("instalando") || lower.contains("installing") || lower.contains("iniciando") || lower.contains("starting") {
                    ("installing", 80u8)
                } else {
                    continue;
                };
                let _ = app2.emit("progress", ProgressEvent {
                    stage: stage.to_string(),
                    label: name_clone.clone(),
                    percent,
                });
            }

            if output.status.success() {
                Ok(meaningful.last().cloned().unwrap_or_default())
            } else {
                let msg = meaningful.iter().rev()
                    .find(|l| l.contains("0x"))
                    .or_else(|| meaningful.last())
                    .cloned()
                    .unwrap_or_else(|| "La operación fue cancelada o se requieren permisos de administrador".to_string());
                Err(msg)
            }
        }
    }).await.map_err(|e| e.to_string())?;

    match &result {
        Ok(_) => {
            emit("done", &name, 100);
            let path = history_path();
            let mut history: Vec<HistoryEntry> = read_json(&path);
            history.insert(0, HistoryEntry { id, name, from_version, to_version, date: now_str() });
            history.truncate(100);
            write_json(&path, &history);
        }
        Err(_) => emit("error", &name, 0),
    }

    result
}

#[tauri::command]
fn get_package_size(id: String) -> String {
    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", &format!("winget show --id {} 2>&1", id)])
        .creation_flags(0x08000000)
        .output()
        .ok();

    let url = output
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .and_then(|text| {
            text.lines()
                .find(|l| l.to_lowercase().contains("url del instalador") || l.to_lowercase().contains("installer url"))
                .and_then(|l| l.splitn(2, ':').nth(1))
                .map(|u| u.trim().to_string())
        });

    let url = match url {
        Some(u) if u.starts_with("http") => u,
        _ => return String::new(),
    };

    let size = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .ok()
        .and_then(|c| c.head(&url).send().ok())
        .and_then(|r| r.headers().get("content-length")?.to_str().ok()?.parse::<u64>().ok());

    match size {
        Some(b) if b > 1_048_576 => format!("{:.1} MB", b as f64 / 1_048_576.0),
        Some(b) if b > 1024 => format!("{:.0} KB", b as f64 / 1024.0),
        Some(b) => format!("{} B", b),
        None => String::new(),
    }
}

// === Historial ===

#[tauri::command]
fn get_history() -> Vec<HistoryEntry> {
    read_json(&history_path())
}

#[tauri::command]
fn clear_history() {
    write_json(&history_path(), &Vec::<HistoryEntry>::new());
}

// === Ignorados ===

#[tauri::command]
fn get_ignored() -> Vec<IgnoredApp> {
    read_json(&ignored_path())
}

#[tauri::command]
fn ignore_app(id: String, name: String) -> Vec<IgnoredApp> {
    let path = ignored_path();
    let mut ignored: Vec<IgnoredApp> = read_json(&path);
    if !ignored.iter().any(|a| a.id == id) {
        ignored.push(IgnoredApp { id, name });
    }
    write_json(&path, &ignored);
    ignored
}

#[tauri::command]
fn unignore_app(id: String) -> Vec<IgnoredApp> {
    let path = ignored_path();
    let mut ignored: Vec<IgnoredApp> = read_json(&path);
    ignored.retain(|a| a.id != id);
    write_json(&path, &ignored);
    ignored
}

// === Aplicaciones instaladas ===

#[tauri::command]
fn list_installed() -> Result<Vec<App>, String> {
    let output = run_winget(&["list", "--disable-interactivity", "--accept-source-agreements"])?;
    Ok(parse_winget_table(&output))
}

#[tauri::command]
async fn uninstall_app(id: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        run_winget(&["uninstall", "--id", &id, "--silent", "--accept-source-agreements"])?;

        let check = Command::new("powershell")
            .args(["-NoProfile", "-Command",
                &format!("winget list --id {} --disable-interactivity --accept-source-agreements", id)
            ])
            .creation_flags(0x08000000)
            .output()
            .map_err(|e| e.to_string())?;

        let output = String::from_utf8_lossy(&check.stdout).to_string();
        if output.contains(&id) {
            Err("La desinstalaci\u{f3}n fue cancelada o no se complet\u{f3}".to_string())
        } else {
            Ok("ok".to_string())
        }
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn repair_app(id: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        run_winget(&["repair", "--id", &id, "--silent", "--accept-package-agreements", "--accept-source-agreements"])
    }).await.map_err(|e| e.to_string())?
}

// === Buscar e instalar ===

#[tauri::command]
fn search_apps(query: String) -> Result<Vec<App>, String> {
    let output = run_winget(&["search", &query, "--disable-interactivity", "--accept-source-agreements"])?;
    Ok(parse_winget_table(&output))
}

#[tauri::command]
async fn install_app(id: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        run_winget(&["install", "--id", &id, "--silent", "--accept-package-agreements", "--accept-source-agreements"])
    }).await.map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            check_winget, install_winget,
            list_upgrades, upgrade_app,
            list_installed, uninstall_app, repair_app,
            get_history, clear_history,
            get_ignored, ignore_app, unignore_app,
            search_apps, install_app,
            get_package_size
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
