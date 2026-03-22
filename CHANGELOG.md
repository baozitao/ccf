# Changelog

## v0.1.2 (2026-03-22)

### Fixed
- Right-click drag now uses main-process cursor polling — no more losing drag on fast movement
- Expand/collapse uses synchronous window resize — no more truncation or flickering
- Dynamic window height: compact when collapsed (~180px), grows when expanded (~630px)
- History popup grows window before opening — no clipping
- Session load pre-grows window before expanding — no truncation
- Double-click on tab strip empty area reliably toggles expand/collapse
- Tab click no longer toggles expand (only switches tabs)
- Open in Terminal uses absolute path `/usr/bin/gnome-terminal`
- Toggle server moved to port 19850 to avoid conflict with permission server

### Added
- Right-click drag from any UI position to move window
- Tab drag-to-reorder
- Session rename from tab strip (double-click tab name)
- Session rename from history list (pencil icon)
- Session delete from history list (trash icon)
- Custom session names synced between tab strip and history list
- ESC to hide window
- F3 global hotkey via GNOME keybinding + HTTP toggle

### Changed
- Content top-aligned (was bottom-aligned) for better drag-to-top support
- Window width reduced to 650px (was 1040px) to minimize transparent dead space
- Removed setShape (incompatible with X11 dragging)
- Removed Electron globalShortcut for F3 (conflicts with GNOME keybinding)

## v0.1.1 (2026-03-22)

### Fixed
- Port conflict between toggle server and permission server
- Build script copies fab.html to dist

## v0.1.0 (2026-03-22)

### Initial Release — Linux adapted fork of [clui-cc](https://github.com/lcoutodemos/clui-cc)

### Added
- Linux/Wayland/XWayland support
- F3 global hotkey (GNOME custom keybinding → HTTP toggle)
- Screenshot via `gnome-screenshot -a` (fallback: scrot, import)
- Voice input with Whisper small model + Linux paths
- Open in Terminal via `gnome-terminal`
- `tar --wildcards` fix for skills installer on GNU tar
- `commands/start-linux.sh` launcher script
- `scripts/build-deb.sh` for .deb packaging
- Bilingual README (English + Chinese)
- .deb package in releases

### Changed
- Window icon from .icns to .png
- Tray icon handling for Linux
- Whisper binary search includes Linux paths (`/usr/bin/`, `~/.local/bin/`)
- Error messages adapted for Linux (apt/pip instead of brew)
