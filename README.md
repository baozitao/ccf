# Clui CC — Command Line User Interface for Claude Code

A lightweight, transparent desktop overlay for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) on macOS. Clui CC wraps the Claude Code CLI in a floating pill interface with multi-tab sessions, a permission approval UI, voice input, and a skills marketplace.

![Clui CC Screenshot](CLUI.png)

## Features

- **Floating overlay** — transparent, click-through window that stays on top. Toggle with `Alt+Space`.
- **Multi-tab sessions** — each tab spawns its own `claude -p` process with independent session state.
- **Permission approval UI** — intercepts tool calls via PreToolUse HTTP hooks so you can review and approve/deny from the UI.
- **Conversation history** — browse and resume past Claude Code sessions.
- **Skills marketplace** — install plugins from Anthropic's GitHub repos without leaving Clui CC.
- **Voice input** — local speech-to-text via Whisper (no cloud transcription).
- **File & screenshot attachments** — paste images or attach files directly.
- **Dual theme** — dark/light mode with system-follow option.

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| **macOS** | 13+ | Transparent window, tray icon, node-pty require macOS |
| **Node.js** | 18+ | Required for Electron 33 |
| **Claude Code CLI** | 2.1+ | `npm install -g @anthropic-ai/claude-code` — must be authenticated |
| **Whisper** (optional) | Any | `brew install whisper-cli` for voice input |

> **No API keys or `.env` file required.** Clui CC uses your existing Claude Code CLI authentication (Pro/Team/Enterprise subscription).

## Quick Start

```bash
# Clone and install
git clone https://github.com/lcoutodemos/cluicc.git
cd cluicc
npm install

# Development (hot-reload)
npm run dev

# Production build
npm run build
npx electron .
```

Or use the convenience scripts:

```bash
./start.sh    # Build + run
./stop.sh     # Kill running instance
```

Toggle the overlay: **Alt+Space** (or **Cmd+Shift+K** as fallback).

## Architecture

Clui CC is an Electron app with three layers:

```
┌─────────────────────────────────────────────────┐
│  Renderer (React 19 + Zustand + Tailwind CSS 4) │
│  Components, theme, state management             │
├─────────────────────────────────────────────────┤
│  Preload (window.clui bridge)                    │
│  Secure IPC surface between renderer and main    │
├─────────────────────────────────────────────────┤
│  Main Process                                    │
│  ControlPlane → RunManager → claude -p (NDJSON)  │
│  PermissionServer (HTTP hooks on 127.0.0.1)      │
│  Marketplace catalog (GitHub raw fetch + cache)   │
└─────────────────────────────────────────────────┘
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full deep-dive.

## Project Structure

```
src/
├── main/                   # Electron main process
│   ├── claude/             # ControlPlane, RunManager, EventNormalizer
│   ├── hooks/              # PermissionServer (PreToolUse HTTP hooks)
│   ├── marketplace/        # Plugin catalog fetching + install
│   ├── skills/             # Skill auto-installer
│   └── index.ts            # Window creation, IPC handlers, tray
├── renderer/               # React frontend
│   ├── components/         # TabStrip, ConversationView, InputBar, etc.
│   ├── stores/             # Zustand session store
│   ├── hooks/              # Event listeners, health reconciliation
│   └── theme.ts            # Dual palette + CSS custom properties
├── preload/                # Secure IPC bridge (window.clui API)
└── shared/                 # Canonical types, IPC channel definitions
```

## How It Works

1. Each tab creates a `claude -p --output-format stream-json` subprocess.
2. NDJSON events are parsed by `RunManager` and normalized by `EventNormalizer`.
3. `ControlPlane` manages tab lifecycle (connecting → idle → running → completed/failed/dead).
4. Tool permission requests arrive via HTTP hooks to `PermissionServer` (localhost only).
5. The renderer polls backend health every 1.5s and reconciles tab state.
6. Sessions are resumed with `--resume <session-id>` for continuity.

## Network Behavior

Clui CC operates almost entirely offline. The only outbound network calls are:

| Endpoint | Purpose | Required |
|----------|---------|----------|
| `raw.githubusercontent.com/anthropics/*` | Marketplace catalog (cached 5 min) | No — graceful fallback |
| `api.github.com/repos/anthropics/*/tarball/*` | Skill auto-install on startup | No — skipped on failure |

No telemetry, analytics, or auto-update mechanisms. All core Claude Code interaction goes through the local CLI.

## Known Limitations

- **macOS only** — transparent overlay, tray icon, and node-pty are macOS-specific. Windows/Linux support is not currently implemented.
- **Requires Claude Code CLI** — Clui CC is a UI layer, not a standalone AI client. You need an authenticated `claude` CLI.
- **Permission mode** — uses `--permission-mode default`. The PTY interactive transport is legacy and disabled by default.

## License

[MIT](LICENSE)
