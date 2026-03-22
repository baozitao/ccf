<div align="center">

<img src="resources/icon.png" width="120" alt="CCF Logo" />

# CCF — Claude Code Floating

**A floating desktop overlay for Claude Code CLI on Linux**

<a href="README_zh.md">🇨🇳 中文</a> &nbsp;|&nbsp; 🇺🇸 English

<p align="center"><img src="docs/images/banner.svg" alt="CCF Banner" width="800"/></p>

<p align="center">🚀 <strong>Float your AI assistant above everything.</strong> A desktop overlay for Claude Code CLI. 🎯</p>

[![GitHub stars](https://img.shields.io/github/stars/baozitao/ccf?style=flat-square&logo=github&color=FFD700)](https://github.com/baozitao/ccf/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Release](https://img.shields.io/github/v/release/baozitao/ccf?style=flat-square&logo=github)](https://github.com/baozitao/ccf/releases)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS-lightgrey?style=flat-square&logo=linux)](https://github.com/baozitao/ccf)
[![Electron](https://img.shields.io/badge/Electron-Powered-47848F?style=flat-square&logo=electron)](https://www.electronjs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](CONTRIBUTING.md)

<br/>

*Stop hiding your terminal. Float it.*

</div>

<hr/>

<div align="center">

![CCF Demo](docs/images/ccf.png)

</div>

---

## What is CCF?

**CCF (Claude Code Floating)** is an always-on-top, transparent floating overlay that wraps the Claude Code CLI in a sleek desktop UI. Toggle it with `F3`, drag it anywhere, manage multiple sessions in tabs, and let it disappear when you don't need it — all without leaving your workflow.

Forked from [clui-cc](https://github.com/lcoutodemos/clui-cc) by Lucas Couto (MIT). Original was macOS-only — this fork brings it to **Linux (GNOME / Wayland / XWayland)** with additional features.

---

## ⚡ Quick Install

### Download .deb (recommended)

```bash
# Download latest release
wget https://github.com/baozitao/ccf/releases/latest/download/ccf_latest_amd64.deb

# Install
sudo dpkg -i ccf_*_amd64.deb

# Launch
ccf
```

### Install via script

```bash
curl -fsSL https://raw.githubusercontent.com/baozitao/ccf/main/scripts/install.sh | bash
```

---

## 🤖 AI Assistant Install Prompt

Give this one-liner to Claude Code or OpenCode to set up CCF automatically:

```
Install CCF from https://github.com/baozitao/ccf — download the latest .deb from releases, install it with dpkg, then set up GNOME F3 global shortcut to run `ccf --toggle`.
```

---

## ✨ Features

| | Feature | Description |
|---|---------|-------------|
| 🪟 | **Floating overlay** | Transparent, always-on-top window that stays out of your way |
| ⌨️ | **F3 global toggle** | Show/hide from anywhere on the desktop via GNOME keybinding |
| 🖱️ | **Right-click drag** | Drag the window by right-clicking on empty areas |
| 📐 | **Dynamic resize** | Window auto-resizes as content grows, snaps back when hidden |
| 🗂️ | **Tab management** | Multiple sessions — rename, delete, and reorder tabs |
| 📜 | **Session history** | Browse, restore, and delete past Claude Code conversations |
| 🎤 | **Voice input** | Local speech-to-text via Whisper (`small` model, no GPU needed) |
| 📸 | **Screenshot** | Capture screen directly via `gnome-screenshot` integration |
| 🛒 | **Skills marketplace** | Browse and install Claude Code slash commands from GitHub |
| 🔒 | **Permission UI** | Review and approve/deny tool calls before they execute |
| 🎨 | **Dual theme** | Dark and light mode with system-follow option |
| 🖥️ | **Open in terminal** | Launch current directory in `gnome-terminal` instantly |

---

## 🐧 Linux vs macOS Comparison

| Feature | macOS (original) | Linux / CCF (this fork) |
|---------|-----------------|------------------------|
| Global hotkey | `⌥ Space` | `F3` via GNOME custom shortcut |
| Screenshot | `screencapture` | `gnome-screenshot` |
| Terminal | Terminal.app | `gnome-terminal` |
| Window shaping | macOS native | Electron `setShape` API |
| Voice / Whisper | `brew install whisper-cli` | `pip install openai-whisper` |
| Package format | `.dmg` / `.app` | `.deb` (Ubuntu/Debian) |
| Wayland support | — | XWayland compatible |

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `F3` | Toggle CCF window (global, set in GNOME) |
| `Esc` | Hide CCF window |
| `Ctrl + T` | New tab |
| `Ctrl + W` | Close current tab |
| `Ctrl + Tab` | Next tab |
| `Ctrl + Shift + Tab` | Previous tab |
| `Ctrl + L` | Clear current session |
| `Ctrl + H` | Open session history |

---

## 📋 Prerequisites

- **OS**: Ubuntu 22.04+ / Debian-based Linux with GNOME desktop
- **Node.js**: >= 18 ([nodejs.org](https://nodejs.org/))
- **Claude Code CLI**: installed and authenticated

  ```bash
  npm install -g @anthropic-ai/claude-code
  claude auth login
  ```

- **Optional**: `gnome-screenshot` for screenshot capture
- **Optional**: `whisper` for voice input

  ```bash
  pip install openai-whisper
  ```

---

## 🔨 Build from Source

```bash
# Clone
git clone https://github.com/baozitao/ccf.git
cd ccf

# Install dependencies
npm install

# Development mode (hot reload)
npm run dev

# Build .deb package
npm run build:linux

# Or run directly without packaging
./commands/start-linux.sh
```

### GNOME F3 Hotkey Setup

Go to **Settings → Keyboard → Custom Shortcuts** and add:

| Field | Value |
|-------|-------|
| Name | CCF Toggle |
| Command | `ccf --toggle` |
| Shortcut | `F3` |

---

## 🏗️ Architecture

```
User input
    │
    ▼
CCF Electron UI
    │
    ├─ Renderer process (React UI, tabs, history)
    │
    └─ Main process
         │
         ├─ Spawns: claude -p  ──► NDJSON stream ──► live render
         │
         └─ Tool call? ──► Permission UI ──► approve / deny
```

---

## 🤝 Contributing

PRs are warmly welcome! Whether it's a bug fix, new feature, or documentation improvement.

1. Fork the repo
2. Create your branch: `git checkout -b feat/my-feature`
3. Commit your changes: `git commit -m 'feat: add awesome feature'`
4. Push: `git push origin feat/my-feature`
5. Open a Pull Request

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting.

---

## 🙏 Credits

- Original project: **[clui-cc](https://github.com/lcoutodemos/clui-cc)** by [Lucas Couto](https://github.com/lcoutodemos) — MIT License
- Inspired by the workflow of [Claude Code](https://docs.anthropic.com/en/docs/claude-code) by Anthropic
- Linux porting and extended features: [baozitao](https://github.com/baozitao)

---

## 📄 License

MIT © [baozitao](https://github.com/baozitao) — see [LICENSE](LICENSE) for details.

This project is a fork of [clui-cc](https://github.com/lcoutodemos/clui-cc) (MIT), with original copyright retained.

---

<div align="center">

Made with ☕ and Claude Code · <a href="README_zh.md">🇨🇳 查看中文版</a>

</div>
