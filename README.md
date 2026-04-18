<div align="center">
  <img src="logo.png" alt="SuperUpdater logo" width="80"/>
  <h1>SuperUpdater</h1>
  <p>A lightweight Windows desktop app to manage and update your installed software using <strong>winget</strong>.</p>

  ![Platform](https://img.shields.io/badge/platform-Windows-blue?logo=windows)
  ![Tauri](https://img.shields.io/badge/Tauri-v2-24C8D8?logo=tauri)
  ![Rust](https://img.shields.io/badge/Rust-stable-orange?logo=rust)
  ![License](https://img.shields.io/badge/license-MIT-green)
</div>

---

## Features

- **Updates** — Lists all pending software updates from winget and lets you update them individually or all at once
- **Installed apps** — Browse every installed application with options to uninstall or repair
- **Search & install** — Search the entire winget catalog and install any app silently
- **Ignore list** — Exclude specific apps from the updates list permanently
- **History** — Keeps a log of every update performed with version info and date
- **i18n** — Full English / Spanish support, persisted across sessions
- **No admin required** — Installs and runs per-user

## Screenshots

> _Coming soon_

## Requirements

- Windows 10 / 11
- [winget](https://aka.ms/getwinget) (the app can install it automatically if missing)

## Installation

Download the latest installer from [Releases](../../releases):

```
- [SuperUpdater_0.1.0.exe](../../releases/tag/v0.1.0)
```

Run it — no admin rights needed.

## Building from source

### Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) 18+
- [Tauri CLI v2](https://tauri.app/start/prerequisites/)
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with **Desktop development with C++**

### Steps

```bash
git clone https://github.com/<your-user>/SuperUpdater.git
cd SuperUpdater
npm install
npm run tauri build
```

The installer will be at:

```
src-tauri/target/release/bundle/nsis/SuperUpdater_x.x.x_x64-setup.exe
```

For development with hot-reload:

```bash
npm run tauri dev
```

## Project structure

```
SuperUpdater/
├── src/                  # Frontend (vanilla HTML + Tailwind CSS)
│   ├── index.html        # Main UI
│   ├── main.js           # App logic & Tauri command calls
│   ├── i18n.js           # English / Spanish translations
│   └── logo.png          # App logo
└── src-tauri/            # Rust backend
    ├── src/
    │   ├── lib.rs        # All Tauri commands (winget wrapper)
    │   └── main.rs       # Entry point
    ├── icons/            # App icons (all sizes)
    ├── capabilities/
    │   └── default.json  # Tauri permissions
    └── tauri.conf.json   # Tauri configuration
```

## Tech stack

| Layer | Technology |
|---|---|
| Framework | [Tauri v2](https://tauri.app/) |
| Backend | Rust |
| Frontend | Vanilla JS + [Tailwind CSS](https://tailwindcss.com/) (CDN) |
| Package manager | winget (Windows Package Manager) |

## How it works

The Rust backend spawns `winget` commands via PowerShell (hidden window, no console flash) and parses the tabular output by detecting column positions from the header line. Results are passed to the frontend as JSON through Tauri's IPC bridge.

Persistent data (ignored apps, update history) is stored as JSON in `%LOCALAPPDATA%\SuperUpdater\`.

## License

MIT
