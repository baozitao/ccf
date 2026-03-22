import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { Clock, ChatCircle, Trash, PencilSimple } from '@phosphor-icons/react'
import { useSessionStore } from '../stores/sessionStore'
import { usePopoverLayer } from './PopoverLayer'
import { useColors } from '../theme'
import type { SessionMeta } from '../../shared/types'

function formatTimeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(isoDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}K`
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`
}

export function HistoryPicker() {
  const resumeSession = useSessionStore((s) => s.resumeSession)
  const isExpanded = useSessionStore((s) => s.isExpanded)
  const activeTab = useSessionStore(
    (s) => s.tabs.find((t) => t.id === s.activeTabId),
    (a, b) => a === b || (!!a && !!b && a.hasChosenDirectory === b.hasChosenDirectory && a.workingDirectory === b.workingDirectory),
  )
  const staticInfo = useSessionStore((s) => s.staticInfo)
  const popoverLayer = usePopoverLayer()
  const colors = useColors()
  const effectiveProjectPath = activeTab?.hasChosenDirectory
    ? activeTab.workingDirectory
    : (staticInfo?.homePath || activeTab?.workingDirectory || '~')

  const [open, setOpen] = useState(false)
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ right: number; top?: number; bottom?: number; maxHeight?: number }>({ right: 0 })

  const updatePos = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    // Always open downward (content is top-aligned on Linux)
    const top = rect.bottom + 6
    setPos({
      top,
      right: window.innerWidth - rect.right,
      maxHeight: window.innerHeight - top - 12,
    })
  }, [isExpanded])

  const loadSessions = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.clui.listSessions(effectiveProjectPath)
      setSessions(result)
    } catch {
      setSessions([])
    }
    setLoading(false)
  }, [effectiveProjectPath])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleToggle = () => {
    if (!open) {
      window.clui.resizeHeight(400)
      updatePos()
      void loadSessions()
    }
    setOpen((o) => !o)
  }

  const handleSelect = (session: SessionMeta) => {
    setOpen(false)
    const title = session.customName
      || (session.firstMessage
        ? (session.firstMessage.length > 30 ? session.firstMessage.substring(0, 27) + '...' : session.firstMessage)
        : session.slug || 'Resumed')
    void resumeSession(session.sessionId, title, effectiveProjectPath)
  }

  const handleDelete = async (e: React.MouseEvent, session: SessionMeta) => {
    e.stopPropagation()
    const result = await window.clui.deleteSession(session.sessionId, effectiveProjectPath)
    if (result.success) {
      setSessions((prev) => prev.filter((s) => s.sessionId !== session.sessionId))
    }
  }

  const handleStartRename = (e: React.MouseEvent, session: SessionMeta) => {
    e.stopPropagation()
    setEditingId(session.sessionId)
    setEditName(session.customName || session.firstMessage || session.slug || '')
  }

  const handleFinishRename = async (sessionId: string) => {
    setEditingId(null)
    const trimmed = editName.trim()
    const result = await window.clui.renameSession(sessionId, trimmed, effectiveProjectPath)
    if (result.success) {
      setSessions((prev) => prev.map((s) =>
        s.sessionId === sessionId ? { ...s, customName: trimmed || null } : s
      ))
      // Sync: if this session is open in a tab, update the tab title too
      if (trimmed) {
        useSessionStore.setState((s) => ({
          tabs: s.tabs.map((t) =>
            t.claudeSessionId === sessionId ? { ...t, title: trimmed } : t
          ),
        }))
      }
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        onClick={handleToggle}
        className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full transition-colors"
        style={{ color: colors.textTertiary }}
        title="Resume a previous session"
      >
        <Clock size={13} />
      </button>

      {popoverLayer && open && createPortal(
        <motion.div
          ref={popoverRef}
          data-clui-ui
          initial={{ opacity: 0, y: isExpanded ? -4 : 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: isExpanded ? -4 : 4 }}
          transition={{ duration: 0.12 }}
          className="rounded-xl"
          style={{
            position: 'fixed',
            ...(pos.top != null ? { top: pos.top } : {}),
            ...(pos.bottom != null ? { bottom: pos.bottom } : {}),
            right: pos.right,
            width: 280,
            pointerEvents: 'auto',
            background: colors.popoverBg,
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            boxShadow: colors.popoverShadow,
            border: `1px solid ${colors.popoverBorder}`,
            ...(pos.maxHeight != null ? { maxHeight: pos.maxHeight } : {}),
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column' as const,
          }}
        >
          <div className="px-3 py-2 text-[11px] font-medium flex-shrink-0" style={{ color: colors.textTertiary, borderBottom: `1px solid ${colors.popoverBorder}` }}>
            Recent Sessions
          </div>

          <div className="overflow-y-auto py-1" style={{ maxHeight: pos.maxHeight != null ? undefined : 180 }}>
            {loading && (
              <div className="px-3 py-4 text-center text-[11px]" style={{ color: colors.textTertiary }}>
                Loading...
              </div>
            )}

            {!loading && sessions.length === 0 && (
              <div className="px-3 py-4 text-center text-[11px]" style={{ color: colors.textTertiary }}>
                No previous sessions found
              </div>
            )}

            {!loading && sessions.map((session) => (
              <div
                key={session.sessionId}
                className="group w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors cursor-pointer"
                onClick={() => editingId !== session.sessionId && handleSelect(session)}
              >
                <ChatCircle size={13} className="flex-shrink-0 mt-0.5" style={{ color: colors.textTertiary }} />
                <div className="min-w-0 flex-1">
                  {editingId === session.sessionId ? (
                    <input
                      autoFocus
                      className="text-[11px] w-full bg-transparent outline-none border-b"
                      style={{ color: colors.textPrimary, borderColor: colors.textTertiary }}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={() => handleFinishRename(session.sessionId)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleFinishRename(session.sessionId)
                        if (e.key === 'Escape') setEditingId(null)
                        e.stopPropagation()
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <div className="text-[11px] truncate" style={{ color: colors.textPrimary }}>
                      {session.customName || session.firstMessage || session.slug || session.sessionId.substring(0, 8)}
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-[10px] mt-0.5" style={{ color: colors.textTertiary }}>
                    <span>{formatTimeAgo(session.lastTimestamp)}</span>
                    <span>{formatSize(session.size)}</span>
                    {session.slug && <span className="truncate">{session.slug}</span>}
                  </div>
                </div>
                <button
                  onClick={(e) => handleStartRename(e, session)}
                  className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded"
                  style={{ color: colors.textTertiary }}
                  title="Rename session"
                >
                  <PencilSimple size={12} />
                </button>
                <button
                  onClick={(e) => handleDelete(e, session)}
                  className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded"
                  style={{ color: colors.textTertiary }}
                  title="Delete session"
                >
                  <Trash size={12} />
                </button>
              </div>
            ))}
          </div>
        </motion.div>,
        popoverLayer,
      )}
    </>
  )
}
