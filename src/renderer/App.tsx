import React, { useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Paperclip, Camera, HeadCircuit } from '@phosphor-icons/react'
import { TabStrip } from './components/TabStrip'
import { ConversationView } from './components/ConversationView'
import { InputBar } from './components/InputBar'
import { StatusBar } from './components/StatusBar'
import { MarketplacePanel } from './components/MarketplacePanel'
import { PopoverLayerProvider } from './components/PopoverLayer'
import { useClaudeEvents } from './hooks/useClaudeEvents'
import { useHealthReconciliation } from './hooks/useHealthReconciliation'
import { useSessionStore } from './stores/sessionStore'
import { useColors, useThemeStore, spacing } from './theme'

const TRANSITION = { duration: 0.26, ease: [0.4, 0, 0.1, 1] as const }

export default function App() {
  useClaudeEvents()
  useHealthReconciliation()

  const activeTabStatus = useSessionStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.status)
  const addAttachments = useSessionStore((s) => s.addAttachments)
  const colors = useColors()
  const setSystemTheme = useThemeStore((s) => s.setSystemTheme)
  const expandedUI = useThemeStore((s) => s.expandedUI)

  // ─── Theme initialization ───
  useEffect(() => {
    // Get initial OS theme — setSystemTheme respects themeMode (system/light/dark)
    window.clui.getTheme().then(({ isDark }) => {
      setSystemTheme(isDark)
    }).catch(() => {})

    // Listen for OS theme changes
    const unsub = window.clui.onThemeChange((isDark) => {
      setSystemTheme(isDark)
    })
    return unsub
  }, [setSystemTheme])

  useEffect(() => {
    useSessionStore.getState().initStaticInfo().then(() => {
      const homeDir = useSessionStore.getState().staticInfo?.homePath || '~'
      const tab = useSessionStore.getState().tabs[0]
      if (tab) {
        // Set working directory to home by default (user hasn't chosen yet)
        useSessionStore.setState((s) => ({
          tabs: s.tabs.map((t, i) => (i === 0 ? { ...t, workingDirectory: homeDir, hasChosenDirectory: false } : t)),
        }))
        window.clui.createTab().then(({ tabId }) => {
          useSessionStore.setState((s) => ({
            tabs: s.tabs.map((t, i) => (i === 0 ? { ...t, id: tabId } : t)),
            activeTabId: tabId,
          }))
        }).catch(() => {})
      }
    })
  }, [])

  // OS-level click-through (macOS only — forward: true doesn't work on Linux/XWayland)
  useEffect(() => {
    if (!window.clui?.setIgnoreMouseEvents) return
    // Detect Linux by checking if navigator.platform starts with Linux
    if (navigator.platform.startsWith('Linux')) return
    let lastIgnored: boolean | null = null

    const onMouseMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const isUI = !!(el && el.closest('[data-clui-ui]'))
      const shouldIgnore = !isUI
      if (shouldIgnore !== lastIgnored) {
        lastIgnored = shouldIgnore
        if (shouldIgnore) {
          window.clui.setIgnoreMouseEvents(true, { forward: true })
        } else {
          window.clui.setIgnoreMouseEvents(false)
        }
      }
    }

    const onMouseLeave = () => {
      if (lastIgnored !== true) {
        lastIgnored = true
        window.clui.setIgnoreMouseEvents(true, { forward: true })
      }
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseleave', onMouseLeave)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseleave', onMouseLeave)
    }
  }, [])

  // ESC to hide window
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        window.clui.hideWindow()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const isExpanded = useSessionStore((s) => s.isExpanded)
  const marketplaceOpen = useSessionStore((s) => s.marketplaceOpen)

  const isRunning = activeTabStatus === 'running' || activeTabStatus === 'connecting'

  // Auto-resize window width for full-width/marketplace modes (Linux only)
  useEffect(() => {
    if (!navigator.platform.startsWith('Linux')) return
    // normal: 190(circles) + 460(content) + 10 = 660
    // full-width: 190 + 700 + 10 = 900
    // marketplace: 920 (720px centered panel)
    const targetW = expandedUI ? 900 : 660
    // Only set width; let height be managed by pre-resize (grow) and observer (grow)
    // Height shrink happens naturally when content shrinks
    window.clui.resizeHeight(0, false, targetW)
  }, [expandedUI, marketplaceOpen])

  // Auto-resize window height to match content (Linux only)
  useEffect(() => {
    if (!navigator.platform.startsWith('Linux')) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let lastH = 0

    const measure = () => {
      const els = document.querySelectorAll('[data-clui-ui]')
      let maxBottom = 0
      els.forEach(el => {
        const b = (el as HTMLElement).getBoundingClientRect().bottom
        if (b > maxBottom) maxBottom = b
      })
      const h = Math.ceil(maxBottom)
      if (h > 0 && h > lastH + 10) {
        lastH = h
        window.clui.resizeHeight(h + 20, true)  // growOnly: observer can only grow
      }
    }

    const debounced = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(measure, 16)
    }

    setTimeout(measure, 300)
    const obs = new MutationObserver(debounced)
    obs.observe(document.body, { childList: true, subtree: true })
    return () => { if (timer) clearTimeout(timer); obs.disconnect() }
  }, [])

  // Layout dimensions — expandedUI widens and heightens the panel
  const contentWidth = expandedUI ? 700 : spacing.contentWidth
  const cardExpandedWidth = expandedUI ? 700 : 460
  const cardCollapsedWidth = expandedUI ? 670 : 430
  const cardCollapsedMargin = expandedUI ? 15 : 15
  const bodyMaxHeight = expandedUI ? 520 : 400

  const handleScreenshot = useCallback(async () => {
    const result = await window.clui.takeScreenshot()
    if (!result) return
    addAttachments([result])
  }, [addAttachments])

  const handleAttachFile = useCallback(async () => {
    const files = await window.clui.attachFiles()
    if (!files || files.length === 0) return
    addAttachments(files)
  }, [addAttachments])

  return (
    <PopoverLayerProvider>
      <div className="flex flex-col h-full" style={{ background: 'transparent' }}
        onPointerDown={(e) => {
          if (e.button !== 2) return
          e.preventDefault()
          // Capture pointer so pointerup fires even when cursor leaves the window
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
          // Tell main process to start polling cursor position
          window.clui.dragStart()
          const onUp = (ev: PointerEvent) => {
            ;(ev.target as HTMLElement).releasePointerCapture?.(ev.pointerId)
            document.removeEventListener('pointerup', onUp)
            window.clui.dragEnd()
          }
          document.addEventListener('pointerup', onUp)
        }}
        onContextMenu={(e) => e.preventDefault()}
      >

        {/* Marketplace panel — outside content div so it's not constrained by contentWidth */}
        <AnimatePresence initial={false}>
          {marketplaceOpen && (
            <div
              data-clui-ui
              style={{
                width: Math.min(660, window.innerWidth - 10),
                marginLeft: 'auto',
                marginRight: 0,
                marginBottom: 14,
                position: 'relative',
                zIndex: 30,
              }}
            >
              <motion.div
                initial={{ opacity: 0, y: 14, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.985 }}
                transition={TRANSITION}
              >
                <div
                  data-clui-ui
                  className="glass-surface overflow-hidden no-drag"
                  style={{
                    borderRadius: 24,
                    maxHeight: 470,
                  }}
                >
                  <MarketplacePanel />
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* ─── 460px content column ─── */}
        <div style={{ width: contentWidth, position: 'relative', marginLeft: 'auto', marginRight: 0, transition: 'width 0.26s cubic-bezier(0.4, 0, 0.1, 1)' }}>

          {/*
            ─── Tabs / message shell ───
            This always remains the chat shell. The marketplace is a separate
            panel rendered above it, never inside it.
          */}
          <motion.div
            data-clui-ui
            className="overflow-hidden flex flex-col drag-region"
            animate={{
              width: isExpanded ? cardExpandedWidth : cardCollapsedWidth,
              marginBottom: isExpanded ? 10 : -14,
              marginLeft: isExpanded ? 0 : cardCollapsedMargin,
              marginRight: isExpanded ? 0 : cardCollapsedMargin,
              background: isExpanded ? colors.containerBg : colors.containerBgCollapsed,
              borderColor: colors.containerBorder,
              boxShadow: isExpanded ? colors.cardShadow : colors.cardShadowCollapsed,
            }}
            transition={TRANSITION}
            style={{
              borderWidth: 1,
              borderStyle: 'solid',
              borderRadius: 20,
              position: 'relative',
              zIndex: isExpanded ? 20 : 10,
            }}
          >
            {/* Tab strip — always mounted */}
            <div className="no-drag">
              <TabStrip />
            </div>

            {/* Body — chat history only; the marketplace is a separate overlay above */}
            <motion.div
              initial={false}
              animate={{
                height: isExpanded ? 'auto' : 0,
                opacity: isExpanded ? 1 : 0,
              }}
              transition={TRANSITION}
              className="overflow-hidden no-drag"
            >
              <div style={{ maxHeight: bodyMaxHeight }}>
                <ConversationView />
                <StatusBar />
              </div>
            </motion.div>
          </motion.div>

          {/* ─── Input row — circles float outside left ─── */}
          {/* marginBottom: shadow buffer so the glass-surface drop shadow isn't clipped at the native window edge */}
          <div data-clui-ui className="relative" style={{ minHeight: 46, zIndex: 15, marginBottom: 10 }}>
            {/* Stacked circle buttons — expand on hover */}
            <div
              data-clui-ui
              className="circles-out no-drag"
            >
              <div className="btn-stack">
                {/* btn-1: Attach (front, rightmost) */}
                <button
                  className="stack-btn stack-btn-1 glass-surface"
                  title="Attach file"
                  onClick={handleAttachFile}
                  disabled={isRunning}
                >
                  <Paperclip size={17} />
                </button>
                {/* btn-2: Screenshot (middle) */}
                <button
                  className="stack-btn stack-btn-2 glass-surface"
                  title="Take screenshot"
                  onClick={handleScreenshot}
                  disabled={isRunning}
                >
                  <Camera size={17} />
                </button>
                {/* btn-3: Skills (back, leftmost) */}
                <button
                  className="stack-btn stack-btn-3 glass-surface"
                  title="Skills & Plugins"
                  onClick={() => useSessionStore.getState().toggleMarketplace()}
                  disabled={isRunning}
                >
                  <HeadCircuit size={17} />
                </button>
              </div>
            </div>

            {/* Input pill */}
            <div
              data-clui-ui
              className="glass-surface w-full no-drag"
              style={{ minHeight: 50, borderRadius: 25, padding: '0 6px 0 16px', background: colors.inputPillBg }}
            >
              <InputBar />
            </div>
          </div>
        </div>
      </div>
    </PopoverLayerProvider>
  )
}
