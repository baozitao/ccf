import { app, BrowserWindow, ipcMain, dialog, screen, globalShortcut, Tray, Menu, nativeImage, nativeTheme, shell, systemPreferences, session } from 'electron'
import { join } from 'path'
import { existsSync, readdirSync, statSync, createReadStream } from 'fs'
import { createInterface } from 'readline'
import { homedir } from 'os'
import { ControlPlane } from './claude/control-plane'
import { ensureSkills, type SkillStatus } from './skills/installer'
import { fetchCatalog, listInstalled, installPlugin, uninstallPlugin } from './marketplace/catalog'
import { log as _log, LOG_FILE, flushLogs } from './logger'
import { getCliEnv } from './cli-env'
import { IPC } from '../shared/types'
import type { RunOptions, NormalizedEvent, EnrichedError } from '../shared/types'

const DEBUG_MODE = process.env.CLUI_DEBUG === '1'
const SPACES_DEBUG = DEBUG_MODE || process.env.CLUI_SPACES_DEBUG === '1'

function getContentSecurityPolicy(): string {
  const isDev = !!process.env.ELECTRON_RENDERER_URL
  const connectSrc = isDev
    ? "connect-src 'self' ws://localhost:* http://localhost:*;"
    : "connect-src 'self';"
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval';"
    : "script-src 'self';"

  return [
    "default-src 'none'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self'",
    connectSrc,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
  ].join('; ')
}

function installContentSecurityPolicy(): void {
  const csp = getContentSecurityPolicy()
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    })
  })
}

function log(msg: string): void {
  _log('main', msg)
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let screenshotCounter = 0
let toggleSequence = 0

// Feature flag: enable PTY interactive permissions transport
const INTERACTIVE_PTY = process.env.CLUI_INTERACTIVE_PERMISSIONS_PTY === '1'

const controlPlane = new ControlPlane(INTERACTIVE_PTY)

// Keep native width fixed to avoid renderer animation vs setBounds race.
// The UI itself still launches in compact mode; extra width is transparent/click-through.
const BAR_WIDTH = 650  // Tight: 180(circles) + 460(content) + 10(pad) = 650; setShape handles click-through
const PILL_HEIGHT = 220  // Starts compact; resizeHeight grows/shrinks dynamically.
const PILL_BOTTOM_MARGIN = 4

// ─── Broadcast to renderer ───

function broadcast(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

function snapshotWindowState(reason: string): void {
  if (!SPACES_DEBUG) return
  if (!mainWindow || mainWindow.isDestroyed()) {
    log(`[spaces] ${reason} window=none`)
    return
  }

  const b = mainWindow.getBounds()
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const visibleOnAll = mainWindow.isVisibleOnAllWorkspaces()
  const wcFocused = mainWindow.webContents.isFocused()

  log(
    `[spaces] ${reason} ` +
    `vis=${mainWindow.isVisible()} focused=${mainWindow.isFocused()} wcFocused=${wcFocused} ` +
    `alwaysOnTop=${mainWindow.isAlwaysOnTop()} allWs=${visibleOnAll} ` +
    `bounds=(${b.x},${b.y},${b.width}x${b.height}) ` +
    `cursor=(${cursor.x},${cursor.y}) display=${display.id} ` +
    `workArea=(${display.workArea.x},${display.workArea.y},${display.workArea.width}x${display.workArea.height})`
  )
}

function scheduleToggleSnapshots(toggleId: number, phase: 'show' | 'hide'): void {
  if (!SPACES_DEBUG) return
  const probes = [0, 100, 400, 1200]
  for (const delay of probes) {
    setTimeout(() => {
      snapshotWindowState(`toggle#${toggleId} ${phase} +${delay}ms`)
    }, delay)
  }
}


// ─── Wire ControlPlane events → renderer ───

controlPlane.on('event', (tabId: string, event: NormalizedEvent) => {
  broadcast('clui:normalized-event', tabId, event)
})

controlPlane.on('tab-status-change', (tabId: string, newStatus: string, oldStatus: string) => {
  broadcast('clui:tab-status-change', tabId, newStatus, oldStatus)
})

controlPlane.on('error', (tabId: string, error: EnrichedError) => {
  broadcast('clui:enriched-error', tabId, error)
})

// ─── Window Shape (click-through for transparent areas on Linux) ───



// ─── Window Creation ───

function createWindow(): void {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const { width: screenWidth, height: screenHeight } = display.workAreaSize
  const { x: dx, y: dy } = display.workArea

  const x = dx + Math.round((screenWidth - BAR_WIDTH) / 2)
  const y = dy + screenHeight - PILL_HEIGHT - PILL_BOTTOM_MARGIN

  mainWindow = new BrowserWindow({
    width: BAR_WIDTH,
    height: PILL_HEIGHT,
    x,
    y,
    // macOS: NSPanel (non-activating, joins all spaces)
    // Linux: 'dock' bypasses GNOME window constraints so the overlay can be placed anywhere
    type: (process.platform === 'darwin' ? 'panel' : 'dock') as any,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    roundedCorners: true,
    backgroundColor: '#00000000',
    show: false,
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  })

  // Belt-and-suspenders: panel already joins all spaces and floats,
  // but explicit flags ensure correct behavior on older Electron builds.
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Linux/Wayland: use 'floating' level so blur fires correctly when clicking other windows
  // macOS: 'screen-saver' is needed for accessory app behavior
  mainWindow.setAlwaysOnTop(true, process.platform === 'darwin' ? 'screen-saver' : 'floating')
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    // macOS: start with click-through, renderer toggles per cursor position
    // Linux: start interactive, renderer handles ignore via mousemove
    if (process.platform === 'darwin') {
      mainWindow?.setIgnoreMouseEvents(true, { forward: true })
    }
    // if (process.env.ELECTRON_RENDERER_URL) {
    //   mainWindow?.webContents.openDevTools({ mode: 'detach' })
    // }
  })

  let forceQuit = false
  app.on('before-quit', () => { forceQuit = true })
  mainWindow.on('close', (e) => {
    if (!forceQuit) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  // Hide on blur — works on macOS; on Linux/Wayland use ESC or F3 toggle
  if (process.platform !== 'linux') {
    mainWindow.on('blur', () => {
      if (mainWindow && mainWindow.isVisible()) {
        mainWindow.hide()
      }
    })
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showWindow(source = 'unknown'): void {
  if (!mainWindow) return
  const toggleId = ++toggleSequence

  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  if (SPACES_DEBUG) {
    log(`[spaces] showWindow#${toggleId} source=${source}`)
    snapshotWindowState(`showWindow#${toggleId} pre-show`)
  }
  mainWindow.show()
  mainWindow.webContents.focus()
  broadcast(IPC.WINDOW_SHOWN)
  if (SPACES_DEBUG) scheduleToggleSnapshots(toggleId, 'show')
}

function toggleWindow(source = 'unknown'): void {
  if (!mainWindow) return
  const toggleId = ++toggleSequence
  if (SPACES_DEBUG) {
    log(`[spaces] toggle#${toggleId} source=${source} start`)
    snapshotWindowState(`toggle#${toggleId} pre`)
  }

  if (mainWindow.isVisible()) {
    mainWindow.hide()
    if (SPACES_DEBUG) scheduleToggleSnapshots(toggleId, 'hide')
  } else {
    showWindow(source)
  }
}

// ─── Resize ───
// growOnly=true: only increase height (for pre-resize before expand/popup)
// growOnly=false: can also shrink (for MutationObserver auto-resize)
ipcMain.handle(IPC.RESIZE_HEIGHT, (_e, height: number, growOnly?: boolean, width?: number) => {
  if (!mainWindow || mainWindow.isDestroyed() || process.platform !== 'linux') return
  if (isDraggingWindow) return
  const newH = height > 0 ? Math.max(200, Math.min(height + 50, 800)) : 0
  const newW = width ? Math.max(400, Math.min(width, 1200)) : 0
  const [x, y] = mainWindow.getPosition()
  const [oldW, oldH] = mainWindow.getSize()
  const finalH = newH > 0 ? newH : oldH
  const finalW = newW > 0 ? newW : oldW
  if (growOnly && finalH <= oldH && finalW <= oldW) return
  const hChanged = newH > 0 && Math.abs(finalH - oldH) > 5
  const wChanged = newW > 0 && Math.abs(finalW - oldW) > 5
  if (hChanged || wChanged) {
    const nw = wChanged ? finalW : oldW
    const nh = hChanged ? finalH : oldH
    log(`[resize] ${oldW}x${oldH} → ${nw}x${nh} (req h=${height} w=${width} grow=${growOnly})`)
    mainWindow.setBounds({ x, y, width: nw, height: nh })
  }
})

ipcMain.on(IPC.SET_WINDOW_WIDTH, () => {
  // No-op — native width is fixed to keep expand/collapse animation smooth.
})

ipcMain.handle(IPC.ANIMATE_HEIGHT, () => {
  // No-op — kept for API compat, animation handled purely in renderer
})

ipcMain.on('clui:clear-shape', () => {
  if (!mainWindow || mainWindow.isDestroyed() || process.platform !== 'linux') return
  const [w, h] = mainWindow.getSize()
  try { mainWindow.setShape([{ x: 0, y: 0, width: w, height: h }]) } catch {}
})

ipcMain.on(IPC.HIDE_WINDOW, () => {
  if (mainWindow) {
    mainWindow.hide()
  }
})

let isDraggingWindow = false
let dragInterval: ReturnType<typeof setInterval> | null = null
let dragLastCursor = { x: 0, y: 0 }
let dragTimeout: ReturnType<typeof setTimeout> | null = null
let dragIdleCount = 0

function stopDrag(): void {
  isDraggingWindow = false
  if (dragInterval) { clearInterval(dragInterval); dragInterval = null }
  if (dragTimeout) { clearTimeout(dragTimeout); dragTimeout = null }
  dragIdleCount = 0
}

// Main-process cursor polling drag — immune to renderer losing mouse events
ipcMain.on('clui:drag-start', () => {
  if (!mainWindow || isDraggingWindow) return
  isDraggingWindow = true
  dragIdleCount = 0
  const cur = screen.getCursorScreenPoint()
  dragLastCursor = { x: cur.x, y: cur.y }
  dragInterval = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      stopDrag()
      return
    }
    const cur = screen.getCursorScreenPoint()
    const dx = cur.x - dragLastCursor.x
    const dy = cur.y - dragLastCursor.y
    dragLastCursor = { x: cur.x, y: cur.y }
    if (dx !== 0 || dy !== 0) {
      dragIdleCount = 0
      const [wx, wy] = mainWindow.getPosition()
      mainWindow.setPosition(wx + dx, wy + dy)
    } else {
      // Safety: if cursor hasn't moved for ~2s, assume mouseup was lost
      dragIdleCount++
      if (dragIdleCount > 120) { stopDrag() }
    }
  }, 16)
  // Hard safety timeout: 30s max drag
  dragTimeout = setTimeout(() => stopDrag(), 30000)
})

ipcMain.on('clui:drag-end', () => {
  stopDrag()
})

ipcMain.handle(IPC.IS_VISIBLE, () => {
  return mainWindow?.isVisible() ?? false
})

// OS-level click-through toggle — renderer calls this on mousemove
// to enable clicks on interactive UI while passing through transparent areas
ipcMain.on(IPC.SET_IGNORE_MOUSE_EVENTS, (event, ignore: boolean, options?: { forward?: boolean }) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win && !win.isDestroyed()) {
    win.setIgnoreMouseEvents(ignore, options || {})
  }
})

// ─── IPC Handlers (typed, strict) ───

ipcMain.handle(IPC.START, async () => {
  log('IPC START — fetching static CLI info')
  const { execSync } = require('child_process')

  let version = 'unknown'
  try {
    version = execSync('claude -v', { encoding: 'utf-8', timeout: 5000, env: getCliEnv() }).trim()
  } catch {}

  let auth: { email?: string; subscriptionType?: string; authMethod?: string } = {}
  try {
    const raw = execSync('claude auth status', { encoding: 'utf-8', timeout: 5000, env: getCliEnv() }).trim()
    auth = JSON.parse(raw)
  } catch {}

  let mcpServers: string[] = []
  try {
    const raw = execSync('claude mcp list', { encoding: 'utf-8', timeout: 5000, env: getCliEnv() }).trim()
    if (raw) mcpServers = raw.split('\n').filter(Boolean)
  } catch {}

  return { version, auth, mcpServers, projectPath: process.cwd(), homePath: require('os').homedir() }
})

ipcMain.handle(IPC.CREATE_TAB, () => {
  const tabId = controlPlane.createTab()
  log(`IPC CREATE_TAB → ${tabId}`)
  return { tabId }
})

ipcMain.on(IPC.INIT_SESSION, (_event, tabId: string) => {
  log(`IPC INIT_SESSION: ${tabId}`)
  controlPlane.initSession(tabId)
})

ipcMain.on(IPC.RESET_TAB_SESSION, (_event, tabId: string) => {
  log(`IPC RESET_TAB_SESSION: ${tabId}`)
  controlPlane.resetTabSession(tabId)
})

ipcMain.handle(IPC.PROMPT, async (_event, { tabId, requestId, options }: { tabId: string; requestId: string; options: RunOptions }) => {
  if (DEBUG_MODE) {
    log(`IPC PROMPT: tab=${tabId} req=${requestId} prompt="${options.prompt.substring(0, 100)}"`)
  } else {
    log(`IPC PROMPT: tab=${tabId} req=${requestId}`)
  }

  if (!tabId) {
    throw new Error('No tabId provided — prompt rejected')
  }
  if (!requestId) {
    throw new Error('No requestId provided — prompt rejected')
  }

  try {
    await controlPlane.submitPrompt(tabId, requestId, options)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    log(`PROMPT error: ${msg}`)
    throw err
  }
})

ipcMain.handle(IPC.CANCEL, (_event, requestId: string) => {
  log(`IPC CANCEL: ${requestId}`)
  return controlPlane.cancel(requestId)
})

ipcMain.handle(IPC.STOP_TAB, (_event, tabId: string) => {
  log(`IPC STOP_TAB: ${tabId}`)
  return controlPlane.cancelTab(tabId)
})

ipcMain.handle(IPC.RETRY, async (_event, { tabId, requestId, options }: { tabId: string; requestId: string; options: RunOptions }) => {
  log(`IPC RETRY: tab=${tabId} req=${requestId}`)
  return controlPlane.retry(tabId, requestId, options)
})

ipcMain.handle(IPC.STATUS, () => {
  return controlPlane.getHealth()
})

ipcMain.handle(IPC.TAB_HEALTH, () => {
  return controlPlane.getHealth()
})

ipcMain.handle(IPC.CLOSE_TAB, (_event, tabId: string) => {
  log(`IPC CLOSE_TAB: ${tabId}`)
  controlPlane.closeTab(tabId)
})

ipcMain.on(IPC.SET_PERMISSION_MODE, (_event, mode: string) => {
  if (mode !== 'ask' && mode !== 'auto') {
    log(`IPC SET_PERMISSION_MODE: invalid mode "${mode}" — ignoring`)
    return
  }
  log(`IPC SET_PERMISSION_MODE: ${mode}`)
  controlPlane.setPermissionMode(mode)
})

ipcMain.handle(IPC.RESPOND_PERMISSION, (_event, { tabId, questionId, optionId }: { tabId: string; questionId: string; optionId: string }) => {
  log(`IPC RESPOND_PERMISSION: tab=${tabId} question=${questionId} option=${optionId}`)
  return controlPlane.respondToPermission(tabId, questionId, optionId)
})

ipcMain.handle(IPC.LIST_SESSIONS, async (_e, projectPath?: string) => {
  log(`IPC LIST_SESSIONS ${projectPath ? `(path=${projectPath})` : ''}`)
  try {
    const cwd = projectPath || process.cwd()
    // Validate projectPath — reject null bytes, newlines, non-absolute paths
    if (/[\0\r\n]/.test(cwd) || !cwd.startsWith('/')) {
      log(`LIST_SESSIONS: rejected invalid projectPath: ${cwd}`)
      return []
    }
    // Claude stores project sessions at ~/.claude/projects/<encoded-path>/
    // Path encoding: replace all '/' with '-' (leading '/' becomes leading '-')
    const encodedPath = cwd.replace(/\//g, '-')
    const sessionsDir = join(homedir(), '.claude', 'projects', encodedPath)
    if (!existsSync(sessionsDir)) {
      log(`LIST_SESSIONS: directory not found: ${sessionsDir}`)
      return []
    }
    const files = readdirSync(sessionsDir).filter((f: string) => f.endsWith('.jsonl'))

    const sessions: Array<{ sessionId: string; slug: string | null; firstMessage: string | null; lastTimestamp: string; size: number }> = []

    // UUID v4 regex — only consider files named as valid UUIDs
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

    for (const file of files) {
      // The filename (without .jsonl) IS the canonical resume ID for `claude --resume`
      const fileSessionId = file.replace(/\.jsonl$/, '')
      if (!UUID_RE.test(fileSessionId)) continue // skip non-UUID files

      const filePath = join(sessionsDir, file)
      const stat = statSync(filePath)
      if (stat.size < 100) continue // skip trivially small files

      // Read lines to extract metadata and validate transcript schema
      const meta: { validated: boolean; slug: string | null; firstMessage: string | null; lastTimestamp: string | null } = {
        validated: false, slug: null, firstMessage: null, lastTimestamp: null,
      }

      await new Promise<void>((resolve) => {
        const rl = createInterface({ input: createReadStream(filePath) })
        rl.on('line', (line: string) => {
          try {
            const obj = JSON.parse(line)
            // Validate: must have expected Claude transcript fields
            if (!meta.validated && obj.type && obj.uuid && obj.timestamp) {
              meta.validated = true
            }
            if (obj.slug && !meta.slug) meta.slug = obj.slug
            if (obj.timestamp) meta.lastTimestamp = obj.timestamp
            if (obj.type === 'user' && !meta.firstMessage) {
              const content = obj.message?.content
              if (typeof content === 'string') {
                meta.firstMessage = content.substring(0, 100)
              } else if (Array.isArray(content)) {
                const textPart = content.find((p: any) => p.type === 'text')
                meta.firstMessage = textPart?.text?.substring(0, 100) || null
              }
            }
          } catch {}
          // Read all lines to get the last timestamp
        })
        rl.on('close', () => resolve())
      })

      if (meta.validated) {
        sessions.push({
          sessionId: fileSessionId,
          slug: meta.slug,
          firstMessage: meta.firstMessage,
          lastTimestamp: meta.lastTimestamp || stat.mtime.toISOString(),
          size: stat.size,
        })
      }
    }

    // Load custom names
    const namesFile = join(sessionsDir, '.session-names.json')
    let customNames: Record<string, string> = {}
    if (existsSync(namesFile)) {
      try { customNames = JSON.parse(require('fs').readFileSync(namesFile, 'utf-8')) } catch {}
    }
    for (const s of sessions) {
      if (customNames[s.sessionId]) s.customName = customNames[s.sessionId]
    }

    // Sort by last timestamp, most recent first
    sessions.sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime())
    return sessions.slice(0, 20) // Return top 20
  } catch (err) {
    log(`LIST_SESSIONS error: ${err}`)
    return []
  }
})

// Load conversation history from a session's JSONL file
ipcMain.handle(IPC.LOAD_SESSION, async (_e, arg: { sessionId: string; projectPath?: string } | string) => {
  const sessionId = typeof arg === 'string' ? arg : arg.sessionId
  const projectPath = typeof arg === 'string' ? undefined : arg.projectPath
  log(`IPC LOAD_SESSION ${sessionId}${projectPath ? ` (path=${projectPath})` : ''}`)

  // Validate sessionId — must be strict UUID to prevent path traversal via crafted filenames
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!UUID_RE.test(sessionId)) {
    log(`LOAD_SESSION: rejected invalid sessionId: ${sessionId}`)
    return []
  }

  try {
    const cwd = projectPath || process.cwd()
    // Validate projectPath — reject null bytes, newlines, non-absolute paths
    if (/[\0\r\n]/.test(cwd) || !cwd.startsWith('/')) {
      log(`LOAD_SESSION: rejected invalid projectPath: ${cwd}`)
      return []
    }
    const encodedPath = cwd.replace(/\//g, '-')
    const filePath = join(homedir(), '.claude', 'projects', encodedPath, `${sessionId}.jsonl`)
    if (!existsSync(filePath)) return []

    const messages: Array<{ role: string; content: string; toolName?: string; timestamp: number }> = []
    await new Promise<void>((resolve) => {
      const rl = createInterface({ input: createReadStream(filePath) })
      rl.on('line', (line: string) => {
        try {
          const obj = JSON.parse(line)
          if (obj.type === 'user') {
            const content = obj.message?.content
            let text = ''
            if (typeof content === 'string') {
              text = content
            } else if (Array.isArray(content)) {
              text = content
                .filter((b: any) => b.type === 'text')
                .map((b: any) => b.text)
                .join('\n')
            }
            if (text) {
              messages.push({ role: 'user', content: text, timestamp: new Date(obj.timestamp).getTime() })
            }
          } else if (obj.type === 'assistant') {
            const content = obj.message?.content
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'text' && block.text) {
                  messages.push({ role: 'assistant', content: block.text, timestamp: new Date(obj.timestamp).getTime() })
                } else if (block.type === 'tool_use' && block.name) {
                  messages.push({
                    role: 'tool',
                    content: '',
                    toolName: block.name,
                    timestamp: new Date(obj.timestamp).getTime(),
                  })
                }
              }
            }
          }
        } catch {}
      })
      rl.on('close', () => resolve())
    })
    return messages
  } catch (err) {
    log(`LOAD_SESSION error: ${err}`)
    return []
  }
})

ipcMain.handle(IPC.DELETE_SESSION, async (_e, arg: { sessionId: string; projectPath?: string }) => {
  const { unlinkSync } = require('fs')
  const projectPath = arg.projectPath || process.cwd()
  const encodedPath = projectPath.replace(/\//g, '-')
  const sessionsDir = join(homedir(), '.claude', 'projects', encodedPath)
  const filePath = join(sessionsDir, `${arg.sessionId}.jsonl`)
  log(`IPC DELETE_SESSION: ${filePath}`)
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath)
      return { success: true }
    }
    return { success: false, error: 'Session file not found' }
  } catch (err: any) {
    log(`DELETE_SESSION error: ${err.message}`)
    return { success: false, error: err.message }
  }
})

ipcMain.handle(IPC.RENAME_SESSION, async (_e, arg: { sessionId: string; name: string; projectPath?: string }) => {
  const { readFileSync, writeFileSync } = require('fs')
  const projectPath = arg.projectPath || process.cwd()
  const encodedPath = projectPath.replace(/\//g, '-')
  const namesFile = join(homedir(), '.claude', 'projects', encodedPath, '.session-names.json')
  log(`IPC RENAME_SESSION: ${arg.sessionId} → "${arg.name}"`)
  try {
    let names: Record<string, string> = {}
    if (existsSync(namesFile)) {
      try { names = JSON.parse(readFileSync(namesFile, 'utf-8')) } catch {}
    }
    if (arg.name.trim()) {
      names[arg.sessionId] = arg.name.trim()
    } else {
      delete names[arg.sessionId]
    }
    writeFileSync(namesFile, JSON.stringify(names, null, 2))
    return { success: true }
  } catch (err: any) {
    log(`RENAME_SESSION error: ${err.message}`)
    return { success: false, error: err.message }
  }
})

ipcMain.handle(IPC.SELECT_DIRECTORY, async () => {
  if (!mainWindow) return null
  // macOS: activate app so unparented dialog appears on top (not behind other apps).
  // Unparented avoids modal dimming on the transparent overlay.
  // Activation is fine here — user is actively interacting with CLUI.
  if (process.platform === 'darwin') app.focus()
  const options = { properties: ['openDirectory'] as const }
  const result = process.platform === 'darwin'
    ? await dialog.showOpenDialog(options)
    : await dialog.showOpenDialog(mainWindow, options)
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle(IPC.OPEN_EXTERNAL, async (_event, url: string) => {
  try {
    // Parse with URL constructor to reject malformed/ambiguous payloads
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    if (!parsed.hostname) return false
    await shell.openExternal(parsed.href)
    return true
  } catch {
    return false
  }
})

ipcMain.handle(IPC.ATTACH_FILES, async () => {
  if (!mainWindow) return null
  // macOS: activate app so unparented dialog appears on top
  if (process.platform === 'darwin') app.focus()
  const options = {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'All Files', extensions: ['*'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
      { name: 'Code', extensions: ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'md', 'json', 'yaml', 'toml'] },
    ],
  }
  const result = process.platform === 'darwin'
    ? await dialog.showOpenDialog(options)
    : await dialog.showOpenDialog(mainWindow, options)
  if (result.canceled || result.filePaths.length === 0) return null

  const { basename, extname } = require('path')
  const { readFileSync, statSync } = require('fs')

  const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'])
  const mimeMap: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown',
    '.json': 'application/json', '.yaml': 'text/yaml', '.toml': 'text/toml',
  }

  return result.filePaths.map((fp: string) => {
    const ext = extname(fp).toLowerCase()
    const mime = mimeMap[ext] || 'application/octet-stream'
    const stat = statSync(fp)
    let dataUrl: string | undefined

    // Generate preview data URL for images (max 2MB to keep IPC fast)
    if (IMAGE_EXTS.has(ext) && stat.size < 2 * 1024 * 1024) {
      try {
        const buf = readFileSync(fp)
        dataUrl = `data:${mime};base64,${buf.toString('base64')}`
      } catch {}
    }

    return {
      id: crypto.randomUUID(),
      type: IMAGE_EXTS.has(ext) ? 'image' : 'file',
      name: basename(fp),
      path: fp,
      mimeType: mime,
      dataUrl,
      size: stat.size,
    }
  })
})

ipcMain.handle(IPC.TAKE_SCREENSHOT, async () => {
  if (!mainWindow) return null

  if (SPACES_DEBUG) snapshotWindowState('screenshot pre-hide')
  mainWindow.hide()
  await new Promise((r) => setTimeout(r, 300))

  try {
    const { execSync } = require('child_process')
    const { join } = require('path')
    const { tmpdir } = require('os')
    const { readFileSync, existsSync } = require('fs')

    const timestamp = Date.now()
    const screenshotPath = join(tmpdir(), `clui-screenshot-${timestamp}.png`)

    if (process.platform === 'darwin') {
      execSync(`/usr/sbin/screencapture -i "${screenshotPath}"`, {
        timeout: 30000,
        stdio: 'ignore',
      })
    } else {
      // Linux: try gnome-screenshot (area select), then scrot, then import (ImageMagick)
      try {
        execSync(`gnome-screenshot -a -f "${screenshotPath}"`, { timeout: 30000, stdio: 'ignore' })
      } catch {
        try {
          execSync(`scrot -s "${screenshotPath}"`, { timeout: 30000, stdio: 'ignore' })
        } catch {
          execSync(`import "${screenshotPath}"`, { timeout: 30000, stdio: 'ignore' })
        }
      }
    }

    if (!existsSync(screenshotPath)) {
      return null
    }

    // Return structured attachment with data URL preview
    const buf = readFileSync(screenshotPath)
    return {
      id: crypto.randomUUID(),
      type: 'image',
      name: `screenshot ${++screenshotCounter}.png`,
      path: screenshotPath,
      mimeType: 'image/png',
      dataUrl: `data:image/png;base64,${buf.toString('base64')}`,
      size: buf.length,
    }
  } catch {
    return null
  } finally {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.webContents.focus()
    }
    broadcast(IPC.WINDOW_SHOWN)
    if (SPACES_DEBUG) {
      log('[spaces] screenshot restore show+focus')
      snapshotWindowState('screenshot restore immediate')
      setTimeout(() => snapshotWindowState('screenshot restore +200ms'), 200)
    }
  }
})

let pasteCounter = 0
ipcMain.handle(IPC.PASTE_IMAGE, async (_event, dataUrl: string) => {
  try {
    const { writeFileSync } = require('fs')
    const { join } = require('path')
    const { tmpdir } = require('os')

    // Parse data URL: "data:image/png;base64,..."
    const match = dataUrl.match(/^data:(image\/(\w+));base64,(.+)$/)
    if (!match) return null

    const [, mimeType, ext, base64Data] = match
    const buf = Buffer.from(base64Data, 'base64')
    const timestamp = Date.now()
    const filePath = join(tmpdir(), `clui-paste-${timestamp}.${ext}`)
    writeFileSync(filePath, buf)

    return {
      id: crypto.randomUUID(),
      type: 'image',
      name: `pasted image ${++pasteCounter}.${ext}`,
      path: filePath,
      mimeType,
      dataUrl,
      size: buf.length,
    }
  } catch {
    return null
  }
})

ipcMain.handle(IPC.TRANSCRIBE_AUDIO, async (_event, audioBase64: string) => {
  const { writeFileSync, existsSync, unlinkSync, readFileSync } = require('fs')
  const { execFile } = require('child_process')
  const { join, basename } = require('path')
  const { tmpdir } = require('os')

  const startedAt = Date.now()
  const phaseMs: Record<string, number> = {}
  const mark = (name: string, t0: number) => { phaseMs[name] = Date.now() - t0 }

  const tmpWav = join(tmpdir(), `clui-voice-${Date.now()}.wav`)
  try {
    const runExecFile = (bin: string, args: string[], timeout: number): Promise<string> =>
      new Promise((resolve, reject) => {
        execFile(bin, args, { encoding: 'utf-8', timeout }, (err: any, stdout: string, stderr: string) => {
          if (err) {
            const detail = stderr?.trim() || stdout?.trim() || err.message
            reject(new Error(detail))
            return
          }
          resolve(stdout || '')
        })
      })

    let t0 = Date.now()
    const buf = Buffer.from(audioBase64, 'base64')
    writeFileSync(tmpWav, buf)
    mark('decode+write_wav', t0)

    // Find whisper-cli (whisper-cpp) or whisper (python)
    t0 = Date.now()
    const candidates = [
      '/opt/homebrew/bin/whisper-cli',
      '/usr/local/bin/whisper-cli',
      '/opt/homebrew/bin/whisper',
      '/usr/local/bin/whisper',
      '/usr/bin/whisper-cli',
      '/usr/bin/whisper',
      join(homedir(), '.local/bin/whisper-cli'),
      join(homedir(), '.local/bin/whisper'),
    ]

    let whisperBin = ''
    for (const c of candidates) {
      if (existsSync(c)) { whisperBin = c; break }
    }
    mark('probe_binary_paths', t0)

    if (!whisperBin) {
      t0 = Date.now()
      const shell = process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'
      const whichCmd = process.platform === 'darwin' ? 'whence -p' : 'which'
      for (const name of ['whisper-cli', 'whisper']) {
        try {
          whisperBin = await runExecFile(shell, ['-lc', `${whichCmd} ${name}`], 5000).then((s) => s.trim())
          if (whisperBin) break
        } catch {}
      }
      mark('probe_binary_whence', t0)
    }

    if (!whisperBin) {
      const installHint = process.platform === 'darwin'
        ? 'brew install whisper-cli'
        : 'pip install openai-whisper  # or: apt install whisper-cpp'
      return {
        error: `Whisper not found. Install with: ${installHint}`,
        transcript: null,
      }
    }

    const isWhisperCpp = whisperBin.includes('whisper-cli')

    // Find model file — prefer multilingual (auto-detect language) over .en (English-only)
    const modelCandidates = [
      join(homedir(), '.local/share/whisper/ggml-base.bin'),
      join(homedir(), '.local/share/whisper/ggml-tiny.bin'),
      '/opt/homebrew/share/whisper-cpp/models/ggml-base.bin',
      '/opt/homebrew/share/whisper-cpp/models/ggml-tiny.bin',
      // Fall back to English-only models if multilingual not available
      join(homedir(), '.local/share/whisper/ggml-base.en.bin'),
      join(homedir(), '.local/share/whisper/ggml-tiny.en.bin'),
      '/opt/homebrew/share/whisper-cpp/models/ggml-base.en.bin',
      '/opt/homebrew/share/whisper-cpp/models/ggml-tiny.en.bin',
    ]

    let modelPath = ''
    for (const m of modelCandidates) {
      if (existsSync(m)) { modelPath = m; break }
    }

    // Detect if using an English-only model (.en suffix) — force English if so
    const isEnglishOnly = modelPath.includes('.en.')
    log(`Transcribing with: ${whisperBin} (model: ${modelPath || 'default'}, lang: ${isEnglishOnly ? 'en' : 'auto'})`)

    let output: string
    if (isWhisperCpp) {
      // whisper-cpp: whisper-cli -m model -f file --no-timestamps
      if (!modelPath) {
        return {
          error: 'Whisper model not found. Download with:\nmkdir -p ~/.local/share/whisper && curl -L -o ~/.local/share/whisper/ggml-tiny.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
          transcript: null,
        }
      }
      const langFlag = isEnglishOnly ? '-l en' : '-l auto'
      t0 = Date.now()
      output = await runExecFile(
        whisperBin,
        ['-m', modelPath, '-f', tmpWav, '--no-timestamps', '-l', isEnglishOnly ? 'en' : 'auto'],
        30000
      )
      mark('whisper_cpp_transcribe', t0)
    } else {
      // Python whisper: prefer larger models for better Chinese accuracy
      // Use small model (good Chinese accuracy, reasonable CPU speed)
      // medium/large too slow without GPU acceleration
      const model = existsSync(join(homedir(), '.cache/whisper/small.pt')) ? 'small' : 'tiny'
      const langArgs = isEnglishOnly ? ['--language', 'en'] : []
      log(`Python whisper using model: ${model}`)
      t0 = Date.now()
      output = await runExecFile(
        whisperBin,
        [tmpWav, '--model', model, ...langArgs, '--output_format', 'txt', '--output_dir', tmpdir()],
        60000
      )
      mark('python_whisper_transcribe', t0)
      // Python whisper writes .txt file
      const txtPath = tmpWav.replace('.wav', '.txt')
      if (existsSync(txtPath)) {
        t0 = Date.now()
        const transcript = readFileSync(txtPath, 'utf-8').trim()
        mark('python_whisper_read_txt', t0)
        try { unlinkSync(txtPath) } catch {}
        log(`Transcription timing(ms): ${JSON.stringify({ ...phaseMs, total: Date.now() - startedAt })}`)
        return { error: null, transcript }
      }
      // File not created — Python whisper failed silently
      return {
        error: `Whisper output file not found at ${txtPath}. Check disk space and permissions.`,
        transcript: null,
      }
    }

    // whisper-cpp prints to stdout directly
    // Strip timestamp patterns and known hallucination outputs
    const HALLUCINATIONS = /^\s*(\[BLANK_AUDIO\]|you\.?|thank you\.?|thanks\.?)\s*$/i
    const transcript = output
      .replace(/\[[\d:.]+\s*-->\s*[\d:.]+\]\s*/g, '')
      .trim()

    if (HALLUCINATIONS.test(transcript)) {
      log(`Transcription timing(ms): ${JSON.stringify({ ...phaseMs, total: Date.now() - startedAt })}`)
      return { error: null, transcript: '' }
    }

    log(`Transcription timing(ms): ${JSON.stringify({ ...phaseMs, total: Date.now() - startedAt })}`)
    return { error: null, transcript: transcript || '' }
  } catch (err: any) {
    log(`Transcription error: ${err.message}`)
    log(`Transcription timing(ms): ${JSON.stringify({ ...phaseMs, total: Date.now() - startedAt, failed: true })}`)
    return {
      error: `Transcription failed: ${err.message}`,
      transcript: null,
    }
  } finally {
    try { unlinkSync(tmpWav) } catch {}
  }
})

ipcMain.handle(IPC.GET_DIAGNOSTICS, () => {
  const { readFileSync, existsSync } = require('fs')
  const health = controlPlane.getHealth()

  let recentLogs = ''
  if (existsSync(LOG_FILE)) {
    try {
      const content = readFileSync(LOG_FILE, 'utf-8')
      const lines = content.split('\n')
      recentLogs = lines.slice(-100).join('\n')
    } catch {}
  }

  return {
    health,
    logPath: LOG_FILE,
    recentLogs,
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    appVersion: app.getVersion(),
    transport: INTERACTIVE_PTY ? 'pty' : 'stream-json',
  }
})

ipcMain.handle(IPC.OPEN_IN_TERMINAL, (_event, arg: string | null | { sessionId?: string | null; projectPath?: string }) => {
  const { execFile } = require('child_process')
  const claudeBin = 'claude'

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  // Support both old (string) and new ({ sessionId, projectPath }) calling convention
  let sessionId: string | null = null
  let projectPath: string = process.cwd()
  if (typeof arg === 'string') {
    sessionId = arg
  } else if (arg && typeof arg === 'object') {
    sessionId = arg.sessionId ?? null
    projectPath = arg.projectPath && arg.projectPath !== '~' ? arg.projectPath : process.cwd()
  }

  // Validate sessionId — must be a strict UUID to prevent injection into the shell command
  if (sessionId && !UUID_RE.test(sessionId)) {
    log(`OPEN_IN_TERMINAL: rejected invalid sessionId: ${sessionId}`)
    return false
  }

  // Sanitize projectPath — reject null bytes, newlines, and non-absolute paths
  if (/[\0\r\n]/.test(projectPath) || !projectPath.startsWith('/')) {
    log(`OPEN_IN_TERMINAL: rejected invalid projectPath: ${projectPath}`)
    return false
  }

  // Shell-safe single-quote escaping: replace ' with '\'' (end quote, escaped literal quote, reopen quote)
  // Single quotes block all shell expansion ($, `, \, etc.) — unlike double quotes which allow $() and backticks
  const shellSingleQuote = (s: string): string => "'" + s.replace(/'/g, "'\\''") + "'"

  const safeDir = shellSingleQuote(projectPath)

  let cmd: string
  if (sessionId) {
    // sessionId is UUID-validated above, safe to embed directly
    cmd = `cd ${safeDir} && ${claudeBin} --resume ${sessionId}`
  } else {
    cmd = `cd ${safeDir} && ${claudeBin}`
  }

  try {
    if (process.platform === 'darwin') {
      // AppleScript string escaping: backslashes doubled, double quotes escaped
      const escapeAppleScript = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      const appleCmd = escapeAppleScript(cmd)
      const script = `tell application "Terminal"\n  activate\n  do script "${appleCmd}"\nend tell`
      execFile('/usr/bin/osascript', ['-e', script], (err: Error | null) => {
        if (err) log(`Failed to open terminal: ${err.message}`)
        else log(`Opened terminal with: ${cmd}`)
      })
    } else {
      // Linux: try common terminal emulators with absolute paths
      const terminals: [string, string[]][] = [
        ['/usr/bin/gnome-terminal', ['--', 'bash', '-c', `${cmd}; exec bash`]],
        ['/usr/bin/xterm', ['-e', `bash -c '${cmd}; exec bash'`]],
        ['/usr/bin/konsole', ['-e', 'bash', '-c', `${cmd}; exec bash`]],
        ['/usr/bin/xfce4-terminal', ['-e', `bash -c '${cmd}; exec bash'`]],
      ]
      let launched = false
      for (const [bin, args] of terminals) {
        if (existsSync(bin)) {
          execFile(bin, args, (err: Error | null) => {
            if (err) log(`Failed to open terminal (${bin}): ${err.message}`)
            else log(`Opened terminal (${bin}) with: ${cmd}`)
          })
          launched = true
          break
        }
      }
      if (!launched) {
        log('No supported terminal emulator found')
        return false
      }
    }
    return true
  } catch (err: unknown) {
    log(`Failed to open terminal: ${err}`)
    return false
  }
})

// ─── Marketplace IPC ───

ipcMain.handle(IPC.MARKETPLACE_FETCH, async (_event, { forceRefresh } = {}) => {
  log('IPC MARKETPLACE_FETCH')
  return fetchCatalog(forceRefresh)
})

ipcMain.handle(IPC.MARKETPLACE_INSTALLED, async () => {
  log('IPC MARKETPLACE_INSTALLED')
  return listInstalled()
})

ipcMain.handle(IPC.MARKETPLACE_INSTALL, async (_event, { repo, pluginName, marketplace, sourcePath, isSkillMd }: { repo: string; pluginName: string; marketplace: string; sourcePath?: string; isSkillMd?: boolean }) => {
  log(`IPC MARKETPLACE_INSTALL: ${pluginName} from ${repo} (isSkillMd=${isSkillMd})`)
  return installPlugin(repo, pluginName, marketplace, sourcePath, isSkillMd)
})

ipcMain.handle(IPC.MARKETPLACE_UNINSTALL, async (_event, { pluginName }: { pluginName: string }) => {
  log(`IPC MARKETPLACE_UNINSTALL: ${pluginName}`)
  return uninstallPlugin(pluginName)
})

// ─── Theme Detection ───

ipcMain.handle(IPC.GET_THEME, () => {
  return { isDark: nativeTheme.shouldUseDarkColors }
})

nativeTheme.on('updated', () => {
  broadcast(IPC.THEME_CHANGED, nativeTheme.shouldUseDarkColors)
})

// ─── Permission Preflight ───
// Request all required macOS permissions upfront on first launch so the user
// is never interrupted mid-session by a permission prompt.

async function requestPermissions(): Promise<void> {
  if (process.platform !== 'darwin') return

  // ── Microphone (for voice input via Whisper) ──
  try {
    const micStatus = systemPreferences.getMediaAccessStatus('microphone')
    if (micStatus === 'not-determined') {
      await systemPreferences.askForMediaAccess('microphone')
    }
  } catch (err: any) {
    log(`Permission preflight: microphone check failed — ${err.message}`)
  }

  // ── Accessibility (for global ⌥+Space shortcut) ──
  // globalShortcut works without it on modern macOS; Cmd+Shift+K is always the fallback.
  // Screen Recording: not requested upfront — macOS 15 Sequoia shows an alarming
  // "bypass private window picker" dialog. Let the OS prompt naturally if/when
  // the screenshot feature is actually used.
}

// ─── App Lifecycle ───

app.whenReady().then(async () => {
  // macOS: become an accessory app. Accessory apps can have key windows (keyboard works)
  // without deactivating the currently active app (hover preserved in browsers).
  // This is how Spotlight, Alfred, Raycast work.
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide()
  }

  // Request permissions upfront so the user is never interrupted mid-session.
  await requestPermissions()

  installContentSecurityPolicy()

  // Skill provisioning — non-blocking, streams status to renderer
  ensureSkills((status: SkillStatus) => {
    log(`Skill ${status.name}: ${status.state}${status.error ? ` — ${status.error}` : ''}`)
    broadcast(IPC.SKILL_STATUS, status)
  }).catch((err: Error) => log(`Skill provisioning error: ${err.message}`))

  createWindow()
  snapshotWindowState('after createWindow')

  if (SPACES_DEBUG) {
    mainWindow?.on('show', () => snapshotWindowState('event window show'))
    mainWindow?.on('hide', () => snapshotWindowState('event window hide'))
    mainWindow?.on('focus', () => snapshotWindowState('event window focus'))
    mainWindow?.on('blur', () => snapshotWindowState('event window blur'))
    mainWindow?.webContents.on('focus', () => snapshotWindowState('event webContents focus'))
    mainWindow?.webContents.on('blur', () => snapshotWindowState('event webContents blur'))

    app.on('browser-window-focus', () => snapshotWindowState('event app browser-window-focus'))
    app.on('browser-window-blur', () => snapshotWindowState('event app browser-window-blur'))

    screen.on('display-added', (_e, display) => {
      log(`[spaces] event display-added id=${display.id}`)
      snapshotWindowState('event display-added')
    })
    screen.on('display-removed', (_e, display) => {
      log(`[spaces] event display-removed id=${display.id}`)
      snapshotWindowState('event display-removed')
    })
    screen.on('display-metrics-changed', (_e, display, changedMetrics) => {
      log(`[spaces] event display-metrics-changed id=${display.id} changed=${changedMetrics.join(',')}`)
      snapshotWindowState('event display-metrics-changed')
    })
  }


  // On Linux/Wayland, Electron's globalShortcut is unreliable — use SIGUSR1 for toggle
  // and register GNOME custom keybinding externally. Keep Electron shortcuts as best-effort.
  if (process.platform === 'linux') {
    // Local HTTP toggle server for GNOME keybinding integration
    const http = require('http')
    const toggleServer = http.createServer((_req: any, res: any) => {
      toggleWindow('http-toggle')
      res.writeHead(200)
      res.end('toggled')
    })
    toggleServer.on('error', (err: any) => {
      log(`Toggle server error: ${err.message} — F3 toggle may not work`)
    })
    toggleServer.listen(19850, '127.0.0.1', () => {
      log('Toggle HTTP server listening on 127.0.0.1:19850')
    })
  }

  // Register global shortcuts on all platforms
  const registered = globalShortcut.register('Ctrl+Space', () => toggleWindow('shortcut Ctrl+Space'))
  if (!registered) log('Ctrl+Space shortcut registration failed')
  globalShortcut.register('CommandOrControl+Shift+K', () => toggleWindow('shortcut Cmd/Ctrl+Shift+K'))
  if (process.platform === 'linux') {
    log('Linux: Ctrl+Space registered + F3 toggle via GNOME keybinding → HTTP 19850')
  }

  const trayIconPath = join(__dirname, process.platform === 'darwin'
    ? '../../resources/trayTemplate.png'
    : '../../resources/icon.png')
  const trayIcon = nativeImage.createFromPath(trayIconPath)
  if (process.platform === 'darwin') trayIcon.setTemplateImage(true)
  tray = new Tray(trayIcon)
  tray.setToolTip('Clui CC — Claude Code UI')
  tray.on('click', () => toggleWindow('tray click'))
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Clui CC', click: () => showWindow('tray menu') },
      { label: 'Quit', click: () => { app.quit() } },
    ])
  )

  // app 'activate' fires when macOS brings the app to the foreground (e.g. after
  // webContents.focus() triggers applicationDidBecomeActive on some macOS versions).
  // Using showWindow here instead of toggleWindow prevents the re-entry race where
  // a summon immediately hides itself because activate fires mid-show.
  app.on('activate', () => showWindow('app activate'))
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  controlPlane.shutdown()
  flushLogs()
})

app.on('window-all-closed', () => {
  // Keep running in tray on both macOS and Linux
})
