# Contributing to CLUI

Thanks for your interest in contributing! CLUI is a desktop overlay for Claude Code, and we welcome bug reports, feature ideas, and pull requests.

## Getting Started

1. Fork and clone the repo
2. `npm install`
3. `npm run dev` — starts Electron with hot-reload
4. Make your changes in `src/`
5. `npm run build` — verify zero TypeScript errors

## Development Tips

- **Main process** changes (`src/main/`) require a full restart (`Ctrl+C` then `npm run dev`).
- **Renderer** changes (`src/renderer/`) hot-reload automatically.
- Set `CLUI_DEBUG=1` to enable verbose main-process logging to `~/.clui-debug.log`.
- The app creates a transparent, click-through window. Use `Alt+Space` to toggle visibility.

## Code Style

- TypeScript strict mode is enforced.
- Use `useColors()` hook for all color references — never hardcode color values.
- Zustand selectors should be narrow and use custom equality functions for performance.
- Prefer editing existing files over creating new ones.

## Pull Requests

1. Create a feature branch from `main`.
2. Keep PRs focused — one concern per PR.
3. Include a brief description of what changed and why.
4. Ensure `npm run build` passes with zero errors.

## Reporting Bugs

Open an issue with:
- macOS version
- Node.js version
- Claude Code CLI version (`claude --version`)
- Steps to reproduce
- Expected vs. actual behavior

## Security

If you discover a security vulnerability, please report it privately. See [SECURITY.md](SECURITY.md).
