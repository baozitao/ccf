# CCF — Claude Code Floating

A floating desktop overlay UI for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI, now adapted for **Linux** (Ubuntu / GNOME / Wayland / XWayland).

> Forked from [clui-cc](https://github.com/lcoutodemos/clui-cc) by Lucas Couto (MIT License). Original was macOS-only; this fork brings it to Linux.

---

## Features

- **Floating overlay** — transparent, click-through window that stays on top. Toggle with `F3` (GNOME global keybinding) or `ESC` to hide.
- **Click-through transparent areas** — uses Electron `setShape` so clicks pass through empty space.
- **Multi-tab sessions** — each tab spawns its own `claude -p` process with independent session state.
- **Conversation history** — browse, rename, and delete past Claude Code sessions.
- **Drag anywhere** — the window is freely draggable across your desktop.
- **Skills marketplace** — install plugins from Anthropic's GitHub repos without leaving CCF.
- **Voice input** — local speech-to-text via Whisper (`small` model, works without GPU).
- **Screenshot** — capture screen directly via `gnome-screenshot` integration.
- **Open in terminal** — launch the current working directory in `gnome-terminal`.
- **Permission approval UI** — intercepts tool calls via PreToolUse HTTP hooks so you can review and approve/deny from the UI.
- **Dual theme** — dark/light mode with system-follow option.

## Linux Adaptations

| Feature | macOS original | Linux (this fork) |
|---------|---------------|-------------------|
| Global hotkey | `⌥ + Space` | `F3` via GNOME keybinding |
| Screenshot | macOS screencapture | `gnome-screenshot` |
| Terminal | macOS Terminal.app | `gnome-terminal` |
| Window shape | macOS native | Electron `setShape` API |
| Voice/Whisper | `brew install whisper-cli` | `whisper` with `small` model |

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated:
  ```bash
  npm install -g @anthropic-ai/claude-code
  claude auth login
  ```
- GNOME desktop environment (Ubuntu 22.04+ recommended)
- Optional: `gnome-screenshot` for screenshot feature
- Optional: `whisper` for voice input (`pip install openai-whisper`)

## Install

```bash
git clone https://github.com/your-fork/clui-cc.git
cd clui-cc
npm install
./commands/start-linux.sh
```

### .deb Package

Pre-built `.deb` packages are available in [Releases](../../releases). Install with:

```bash
sudo dpkg -i ccf_*.deb
```

### GNOME F3 Hotkey Setup

Go to **Settings → Keyboard → Custom Shortcuts**, add a shortcut that sends `F3` to toggle the CCF window, or follow the in-app setup guide on first launch.

### Developer Mode

```bash
npm run dev
```

Renderer changes update instantly. Main-process changes require restarting `npm run dev`.

## How It Works

```
UI prompt → Main process spawns claude -p → NDJSON stream → live render
                                         → tool call? → permission UI → approve/deny
```

Each tab creates a `claude -p --output-format stream-json` subprocess. NDJSON events are parsed and normalized in real time. Sessions are resumed with `--resume <session-id>` for continuity.

## Project Structure

```
src/
├── main/           # Electron main process (window, IPC, tray)
│   ├── claude/     # ControlPlane, RunManager, EventNormalizer
│   ├── hooks/      # PermissionServer (PreToolUse HTTP hooks)
│   ├── marketplace/ # Plugin catalog fetching + install
│   └── skills/     # Skill auto-installer
├── renderer/       # React frontend (TabStrip, ConversationView, InputBar…)
├── preload/        # Secure IPC bridge (window.clui API)
└── shared/         # Canonical types, IPC channel definitions
commands/
└── start-linux.sh  # Linux launch script
```

## Contributing

PRs welcome, especially for other Linux desktop environments (KDE Plasma, Sway/wlroots, etc.). Please open an issue first to discuss the approach.

## License

[MIT](LICENSE) — original copyright © Lucas Couto, adaptations © 2025 contributors.

---

# CCF — Claude Code Floating（中文说明）

CCF 是 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI 的浮动桌面悬浮窗 UI，已适配 **Linux**（Ubuntu / GNOME / Wayland / XWayland）。

> 本项目 fork 自 [clui-cc](https://github.com/lcoutodemos/clui-cc)（作者：Lucas Couto，MIT 许可证）。原版仅支持 macOS，本 fork 将其移植到 Linux。

---

## 功能特性

- **浮动悬浮窗** — 透明、点击穿透的置顶窗口。按 `F3`（GNOME 全局快捷键）切换显示/隐藏，按 `ESC` 隐藏。
- **点击穿透透明区域** — 使用 Electron `setShape` API，空白区域的鼠标点击直接穿透到底层窗口。
- **多标签会话** — 每个标签独立运行一个 `claude -p` 进程，拥有独立的会话状态。
- **对话历史** — 浏览、重命名、删除历史 Claude Code 会话。
- **任意拖动** — 窗口可在桌面上自由拖动。
- **技能市场** — 无需离开 CCF，直接从 Anthropic GitHub 仓库安装插件。
- **语音输入** — 本地语音转文字，使用 Whisper `small` 模型，无需 GPU。
- **截图** — 通过 `gnome-screenshot` 集成直接截取屏幕。
- **在终端中打开** — 用 `gnome-terminal` 打开当前工作目录。
- **工具调用审批 UI** — 通过 PreToolUse HTTP hooks 拦截工具调用，在 UI 中审批/拒绝。
- **双主题** — 深色/浅色模式，支持跟随系统。

## Linux 适配说明

| 功能 | macOS 原版 | Linux（本 fork） |
|------|-----------|----------------|
| 全局快捷键 | `⌥ + Space` | `F3`（GNOME 自定义快捷键） |
| 截图 | macOS screencapture | `gnome-screenshot` |
| 终端 | macOS Terminal.app | `gnome-terminal` |
| 窗口形状/穿透 | macOS 原生 | Electron `setShape` API |
| 语音/Whisper | `brew install whisper-cli` | `whisper`（small 模型） |

## 前置条件

- [Node.js](https://nodejs.org/) >= 18
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) 已安装并完成授权：
  ```bash
  npm install -g @anthropic-ai/claude-code
  claude auth login
  ```
- GNOME 桌面环境（推荐 Ubuntu 22.04+）
- 可选：`gnome-screenshot`（截图功能）
- 可选：`whisper`（语音输入，`pip install openai-whisper`）

## 安装

```bash
git clone https://github.com/your-fork/clui-cc.git
cd clui-cc
npm install
./commands/start-linux.sh
```

### .deb 包安装

[Releases](../../releases) 页面提供预编译的 `.deb` 包，安装方式：

```bash
sudo dpkg -i ccf_*.deb
```

### GNOME F3 快捷键设置

进入 **设置 → 键盘 → 自定义快捷键**，添加触发 `F3` 的快捷键来切换 CCF 窗口，或参考首次启动时的应用内引导。

### 开发模式

```bash
npm run dev
```

渲染层修改即时生效；主进程修改需重启 `npm run dev`。

## 工作原理

```
UI 输入 → 主进程启动 claude -p → NDJSON 流 → 实时渲染
                              → 工具调用? → 审批 UI → 批准/拒绝
```

每个标签创建一个 `claude -p --output-format stream-json` 子进程，NDJSON 事件被实时解析和归一化。通过 `--resume <session-id>` 恢复历史会话。

## 贡献

欢迎 PR，特别是对其他 Linux 桌面环境（KDE Plasma、Sway/wlroots 等）的适配。建议先开 Issue 讨论方案。

## 许可证

[MIT](LICENSE) — 原始版权 © Lucas Couto，Linux 适配 © 2025 贡献者。
