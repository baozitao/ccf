import React, { useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, X } from '@phosphor-icons/react'
import { useSessionStore } from '../stores/sessionStore'
import { HistoryPicker } from './HistoryPicker'
import { SettingsPopover } from './SettingsPopover'
import { useColors } from '../theme'
import type { TabStatus } from '../../shared/types'

function StatusDot({ status, hasUnread, hasPermission }: { status: TabStatus; hasUnread: boolean; hasPermission: boolean }) {
  const colors = useColors()
  let bg: string = colors.statusIdle
  let pulse = false
  let glow = false

  if (status === 'dead' || status === 'failed') {
    bg = colors.statusError
  } else if (hasPermission) {
    bg = colors.statusPermission
    glow = true
  } else if (status === 'connecting' || status === 'running') {
    bg = colors.statusRunning
    pulse = true
  } else if (hasUnread) {
    bg = colors.statusComplete
  }

  return (
    <span
      className={`w-[6px] h-[6px] rounded-full flex-shrink-0 ${pulse ? 'animate-pulse-dot' : ''}`}
      style={{
        background: bg,
        ...(glow ? { boxShadow: `0 0 6px 2px ${colors.statusPermissionGlow}` } : {}),
      }}
    />
  )
}

export function TabStrip() {
  const tabs = useSessionStore((s) => s.tabs)
  const activeTabId = useSessionStore((s) => s.activeTabId)
  const selectTab = useSessionStore((s) => s.selectTab)
  const createTab = useSessionStore((s) => s.createTab)
  const closeTab = useSessionStore((s) => s.closeTab)
  const colors = useColors()
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleClick = useCallback((tabId: string) => {
    if (editingTabId) return
    if (clickTimer.current) {
      clearTimeout(clickTimer.current)
      clickTimer.current = null
      return // double-click detected, skip selectTab
    }
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null
      selectTab(tabId)
    }, 250)
  }, [editingTabId, selectTab])

  const handleDoubleClick = (e: React.MouseEvent, tabId: string, currentTitle: string) => {
    e.stopPropagation()
    if (clickTimer.current) {
      clearTimeout(clickTimer.current)
      clickTimer.current = null
    }
    setEditingTabId(tabId)
    setEditTitle(currentTitle)
  }

  const handleFinishEdit = (tabId: string) => {
    setEditingTabId(null)
    if (editTitle.trim()) {
      const state = useSessionStore.getState()
      const tab = state.tabs.find((t) => t.id === tabId)
      const activeTab = state.tabs.find((t) => t.id === state.activeTabId)
      useSessionStore.setState((s) => ({
        tabs: s.tabs.map((t) => t.id === tabId ? { ...t, title: editTitle.trim() } : t),
      }))
      // Persist rename to session history
      if (tab?.claudeSessionId) {
        const projectPath = activeTab?.hasChosenDirectory
          ? activeTab.workingDirectory
          : (state.staticInfo?.homePath || activeTab?.workingDirectory || '~')
        window.clui.renameSession(tab.claudeSessionId, editTitle.trim(), projectPath).catch(() => {})
      }
    }
  }

  const toggleExpanded = useSessionStore((s) => s.toggleExpanded)

  return (
    <div
      data-clui-ui
      className="flex items-center no-drag"
      style={{ padding: '8px 0' }}
      onDoubleClick={(e) => {
        // Double-click on empty area (not on tabs/buttons) toggles expand
        const target = e.target as HTMLElement
        if (!target.closest('button, [role="tab"], .group')) {
          toggleExpanded()
        }
      }}
    >
      {/* Scrollable tabs area — clipped by master card edge */}
      <div className="relative min-w-0 flex-1">
        <div
          className="flex items-center gap-1 overflow-x-auto min-w-0"
          style={{
            scrollbarWidth: 'none',
            paddingLeft: 8,
            paddingRight: 14,
            maskImage: 'linear-gradient(to right, black 0%, black calc(100% - 40px), transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to right, black 0%, black calc(100% - 40px), transparent 100%)',
          }}
        >
          <AnimatePresence mode="popLayout">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId
              return (
                <motion.div
                  key={tab.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => handleClick(tab.id)}
                  onDoubleClick={(e) => handleDoubleClick(e, tab.id, tab.title)}
                  className="group flex items-center gap-1.5 cursor-pointer select-none flex-shrink-0 max-w-[160px] transition-all duration-150"
                  style={{
                    background: isActive ? colors.tabActive : 'transparent',
                    border: isActive ? `1px solid ${colors.tabActiveBorder}` : '1px solid transparent',
                    borderRadius: 9999,
                    padding: '4px 10px',
                    fontSize: 12,
                    color: isActive ? colors.textPrimary : colors.textTertiary,
                    fontWeight: isActive ? 500 : 400,
                  }}
                >
                  <StatusDot status={tab.status} hasUnread={tab.hasUnread} hasPermission={tab.permissionQueue.length > 0} />
                  {editingTabId === tab.id ? (
                    <input
                      autoFocus
                      className="truncate flex-1 bg-transparent outline-none text-[12px]"
                      style={{ color: colors.textPrimary, width: 80 }}
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onBlur={() => handleFinishEdit(tab.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleFinishEdit(tab.id)
                        if (e.key === 'Escape') setEditingTabId(null)
                        e.stopPropagation()
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="truncate flex-1">{tab.title}</span>
                  )}
                  {tabs.length > 1 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
                      className="flex-shrink-0 rounded-full w-4 h-4 flex items-center justify-center transition-opacity"
                      style={{
                        opacity: isActive ? 0.5 : 0,
                        color: colors.textSecondary,
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = isActive ? '0.5' : '0' }}
                    >
                      <X size={10} />
                    </button>
                  )}
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      </div>

      {/* Pinned action buttons — always visible on the right */}
      <div className="flex items-center gap-0.5 flex-shrink-0 ml-1 pr-2">
        <button
          onClick={() => createTab()}
          className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full transition-colors"
          style={{ color: colors.textTertiary }}
          title="New tab"
        >
          <Plus size={14} />
        </button>

        <HistoryPicker />

        <SettingsPopover />
      </div>
    </div>
  )
}
