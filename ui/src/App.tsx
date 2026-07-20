import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { onHostMessage, sendToHost } from './bridge'
import { useStylesStore } from './store/stylesStore'
import { SearchBar } from './components/SearchBar'
import { SourceFilter } from './components/SourceFilter'
import { Sidebar } from './components/Sidebar'
import { StyleGrid } from './components/StyleGrid'
import { StyleInfoPanel } from './components/StyleInfoPanel'
import { SelectedBar } from './components/SelectedBar'
import { ThumbProgressModal } from './components/ThumbProgressModal'
import { Toast } from './components/Toast'
import { ConfirmInputDialog } from './components/ConfirmInputDialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './components/ui/tooltip'
import { cn } from './lib/utils'

const ToolBtn = ({
  icon,
  label,
  title,
  onClick,
  disabled,
}: {
  icon: string
  label: string
  title?: string
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
}) => {
  const button = (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'w-8 h-8 flex items-center justify-center rounded transition-colors text-sm border',
        disabled
          ? 'opacity-45 cursor-not-allowed text-sg-muted border-transparent [filter:grayscale(0.35)]'
          : 'text-sg-muted hover:text-sg-text hover:bg-sg-surface border-transparent hover:border-sg-border',
      )}
    >
      {icon}
    </button>
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {disabled ? (
          <span className="inline-flex rounded">{button}</span>
        ) : (
          button
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p className="text-xs max-w-[240px] whitespace-pre-line">{label}</p>
      </TooltipContent>
    </Tooltip>
  )
}

export default function App() {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [presetSaveOpen, setPresetSaveOpen] = useState(false)
  const [ieMenuPos, setIeMenuPos] = useState<{ x: number; y: number } | null>(null)
  const importFileInputRef = useRef<HTMLInputElement>(null)
  const {
    setStyles,
    tab,
    selectedStyles,
    styles,
    conflicts,
    silentMode,
    toggleSilent,
    toggleStyle,
    toggleCompact,
    collapsedCategories,
    collapseAll,
    expandAll,
    showToast,
    presets,
    fetchPresets,
  } = useStylesStore()

  useEffect(() => {
    useStylesStore.getState().loadUsage()
    const unsub = onHostMessage((msg) => {
      if (msg.type === 'SG_INIT' || msg.type === 'SG_STYLES_UPDATE') {
        const raw: unknown = (msg as { styles?: unknown }).styles
        const arr = Array.isArray(raw)
          ? raw
          : Array.isArray((raw as { styles?: unknown[] } | null)?.styles)
            ? (raw as { styles: unknown[] }).styles
            : (raw as { categories?: Record<string, unknown[]> } | null)?.categories
              ? Object.values((raw as { categories: Record<string, unknown[]> }).categories).flat()
              : []
        setStyles(
          arr,
          msg.type === 'SG_INIT'
            ? msg.tab
            : useStylesStore.getState().tab,
        )
        void useStylesStore.getState().fetchPresets()
      }
      if (msg.type === 'SG_HOST_TAB') {
        useStylesStore.setState({ tab: msg.tab })
      }
      if (msg.type === 'SG_CLOSE') {
        sendToHost({ type: 'SG_CLOSE_REQUEST' })
      }
      if (msg.type === 'SG_CLEAR_SELECTION') {
        useStylesStore.setState({ selectedStyles: [], conflicts: [], activeWildcards: [] })
      }
      if (msg.type === 'SG_STYLE_APPLIED') {
        const { selectedStyles, addToRecent } = useStylesStore.getState()
        const exists = selectedStyles.some(s => s.name === msg.style.name)
        if (!exists) {
          useStylesStore.getState().setSelectedStyles([...selectedStyles, msg.style])
          addToRecent(msg.style.name)
        }
      }
      if (msg.type === 'SG_WILDCARDS_ACTIVE') {
        useStylesStore.getState().setActiveWildcards(msg.categories)
      }
    })
    sendToHost({ type: 'SG_READY' })
    return unsub
  }, [setStyles])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        sendToHost({ type: 'SG_CLOSE_REQUEST' })
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  const toggleFullscreen = () => {
    const iframe = window.frameElement as HTMLElement
    if (!iframe) return
    const wrapper = iframe.parentElement as HTMLElement
    if (!wrapper) return

    if (isFullscreen) {
      // Windowed mode (master-like): centered and readable
      wrapper.style.top = '80px'
      wrapper.style.right = '16px'
      wrapper.style.left = 'auto'
      wrapper.style.transform = 'none'
      wrapper.style.width = '1000px'
      wrapper.style.height = '650px'
      wrapper.style.minWidth = '600px'
      wrapper.style.minHeight = '400px'
      wrapper.style.maxWidth = '95vw'
      wrapper.style.maxHeight = '90vh'
      wrapper.style.borderRadius = '12px'
      wrapper.style.boxShadow = '0 25px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)'
      wrapper.style.resize = 'both'
      setIsFullscreen(false)
      return
    }

    // Fullscreen mode
    wrapper.style.top = '0'
    wrapper.style.right = 'auto'
    wrapper.style.left = '0'
    wrapper.style.transform = 'none'
    wrapper.style.width = '100vw'
    wrapper.style.height = '100vh'
    wrapper.style.minWidth = ''
    wrapper.style.minHeight = ''
    wrapper.style.maxWidth = ''
    wrapper.style.maxHeight = ''
    wrapper.style.borderRadius = '0'
    wrapper.style.boxShadow = 'none'
    wrapper.style.resize = 'none'
    setIsFullscreen(true)
  }

  return (
    <div className="flex flex-col bg-sg-bg text-sg-text"
      style={{ height: '100vh', overflow: 'hidden' }}>
      {/* Header */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2.5
                    border-b border-sg-border">
        <span className="text-sg-accent font-semibold">🎨 Style Grid</span>
        <SourceFilter />
        <div className="flex-1">
          <SearchBar />
        </div>
        <TooltipProvider>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => toggleSilent()}
              title={silentMode ? 'Silent mode ON' : 'Silent mode OFF'}
              className={`w-8 h-8 flex items-center justify-center rounded
              transition-colors text-sm border border-transparent shrink-0
            ${silentMode 
              ? 'bg-sg-accent/20 text-sg-accent' 
              : 'text-sg-muted hover:text-sg-text hover:bg-sg-surface hover:border-sg-border'}`}
            >
              👁
            </button>
            <ToolBtn
              icon="🎲"
              label="Random style"
              onClick={() => {
                const available = styles.filter(
                  (s) => !selectedStyles.some((sel) => sel.name === s.name),
                )
                if (available.length === 0) {
                  showToast('All styles already applied', 'info')
                  return
                }
                const pick = available[Math.floor(Math.random() * available.length)]
                toggleStyle(pick)
              }}
            />
            <ToolBtn
              icon="📦"
              label="Presets"
              onClick={() => {
                if (selectedStyles.length === 0) {
                  showToast('Select at least one style first', 'info')
                  return
                }
                setPresetSaveOpen(true)
              }}
            />
            <ToolBtn
              icon="💾"
              label="Backup CSV"
              onClick={async () => {
                try {
                  const res = await fetch('/style_grid/backup', { method: 'POST' })
                  const data = await res.json().catch(() => ({}))
                  if (!res.ok || data.ok === false || data.error) {
                    showToast(
                      typeof data.error === 'string' && data.error
                        ? data.error
                        : 'Backup failed',
                      'error',
                    )
                    return
                  }
                  showToast('💾 Backup created', 'success')
                } catch {
                  showToast('Backup failed', 'error')
                }
              }}
            />
            <ToolBtn
              icon="📥"
              label="Import/Export"
              onClick={(e) => {
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                setIeMenuPos({ x: rect.left, y: rect.bottom + 4 })
              }}
            />
            <ToolBtn
              icon="📋"
              label={'CSV table editor is temporarily unavailable.'}
              disabled
            />
            <ToolBtn
              icon="🧹"
              label="Clear all selected styles"
              title="Clear all selected styles"
              onClick={() => {
                useStylesStore.getState().clearAll()
                sendToHost({ type: 'SG_CLEAR_ALL' })
              }}
            />
            <ToolBtn
              icon="▪"
              label="Compact mode"
              onClick={() => toggleCompact()}
            />
            <ToolBtn
              icon="↕"
              label="Collapse all"
              onClick={() =>
                collapsedCategories.size > 0 ? expandAll() : collapseAll()
              }
            />
            <ToolBtn
              icon="➕"
              label="New style"
              onClick={() => {
                const { activeSource, showToast } = useStylesStore.getState()
                if (!activeSource) {
                  showToast('⚠️ Select a specific CSV source before creating a style', 'info')
                } else {
                  sendToHost({ type: 'SG_NEW_STYLE', sourceFile: activeSource })
                }
              }}
            />
            <span className="text-xs text-sg-muted">
              {selectedStyles.length > 0 && `${selectedStyles.length} selected`}
            </span>
            {conflicts.length > 0 && (
              <div className="relative group">
                <span className="flex items-center gap-1 px-2 py-1 rounded 
                       bg-red-500/20 border border-red-500/40 
                       text-red-400 text-xs cursor-help
                       animate-pulse">
                  ⚠️ {conflicts.length}
                </span>
                <div className="absolute top-full right-0 pt-1 z-50
                      bg-[#0f172a] border border-sg-border rounded-lg
                      shadow-xl p-3 min-w-64 max-w-[min(20rem,calc(100vw-2.5rem))]
                      hidden group-hover:block">
                  <div className="text-xs font-semibold text-white mb-2">
                    Style Conflicts
                  </div>
                  {conflicts.map((c, i) => {
                    const conflictingStyle = selectedStyles.find(s => s.name === c.styleB)
                      ?? styles.find(s => s.name === c.styleB)
                    return (
                      <div key={i} className="flex items-start justify-between gap-2 py-0.5">
                        <span className="text-xs text-red-400 min-w-0 flex-1 break-words">
                          {c.reason}
                        </span>
                        {conflictingStyle && (
                          <button
                            onClick={() => toggleStyle(conflictingStyle)}
                            className="text-xs px-1.5 py-0.5 rounded border
                              border-red-500/40 text-red-400 hover:bg-red-500/20
                              transition-colors shrink-0"
                            title={`Remove "${c.styleB}"`}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            <button
              onClick={toggleFullscreen}
              className="text-sg-muted hover:text-sg-text transition-colors text-sm w-6 h-6
               flex items-center justify-center"
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
                  xmlns="http://www.w3.org/2000/svg">
                  <rect x="1" y="1" width="12" height="12" rx="1"
                    stroke="currentColor" strokeWidth="1.2" fill="none" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
                  xmlns="http://www.w3.org/2000/svg">
                  <rect x="1" y="3" width="9" height="9" rx="1"
                    stroke="currentColor" strokeWidth="1.2" fill="none" />
                  <path d="M4 3V2a1 1 0 011-1h7a1 1 0 011 1v7a1 1 0 01-1 1h-1"
                    stroke="currentColor" strokeWidth="1.2" />
                </svg>
              )}
            </button>
            <button
              type="button"
              onClick={() => sendToHost({ type: 'SG_CLOSE_REQUEST' })}
              className="ml-3 text-sg-muted hover:text-sg-text transition-colors text-lg"
            >
              ✕
            </button>
          </div>
        </TooltipProvider>
      </div>

      {/* Body */}
      <div className="flex min-h-0" style={{ flex: '1 1 0', overflow: 'hidden' }}>
        {/* Sidebar */}
        <div className="shrink-0 border-r border-sg-border p-2 min-h-0"
          style={{ width: isFullscreen ? '210px' : '210px', overflowY: 'auto', overflowX: 'auto' }}>
          <Sidebar />
        </div>

        {/* Grid */}
        <div className="p-3 min-h-0"
          style={{ flex: '1 1 0', overflowY: 'auto', overflowX: 'auto', minWidth: 0 }}>
          <StyleGrid windowed={!isFullscreen} />
        </div>
      </div>

      {/* Bottom panels — fixed height */}
      <div className="shrink-0">
        <StyleInfoPanel />
        <SelectedBar />
      </div>
      <ThumbProgressModal />
      <ConfirmInputDialog
        open={presetSaveOpen}
        title="Save preset"
        placeholder="Preset name"
        confirmLabel="Save"
        onCancel={() => setPresetSaveOpen(false)}
        onConfirm={async (name) => {
          if (presets[name] && !window.confirm(`Overwrite existing preset "${name}"?`)) {
            return  // keep dialog open, let them rename
          }
          try {
            const res = await fetch('/style_grid/presets/save', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name,
                styles: selectedStyles.map((s) => s.name),
              }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok || data.ok === false || data.error) {
              showToast(
                typeof data.error === 'string' && data.error
                  ? data.error
                  : 'Save preset failed',
                'error',
              )
              return
            }
            // This endpoint returns the updated presets map directly —
            // unlike style/save, no separate refetch of /style_grid/styles
            // is needed here.
            if (data.presets) {
              useStylesStore.setState({ presets: data.presets })
            } else {
              await fetchPresets()
            }
            showToast(`Saved preset "${name}"`, 'success')
            setPresetSaveOpen(false)
          } catch {
            showToast('Save preset failed', 'error')
          }
        }}
      />
      {ieMenuPos && (
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setIeMenuPos(null)} />
          <div
            className="fixed z-[9999] bg-sg-surface border border-sg-border rounded-lg shadow-xl py-1 min-w-48"
            style={{ left: ieMenuPos.x, top: ieMenuPos.y }}
          >
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors"
              onClick={async () => {
                setIeMenuPos(null)
                try {
                  const res = await fetch('/style_grid/export')
                  const data = await res.json().catch(() => ({}))
                  if (!res.ok || data.error) {
                    showToast(
                      typeof data.error === 'string' && data.error ? data.error : 'Export failed',
                      'error',
                    )
                    return
                  }
                  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `style_grid_export_${new Date().toISOString().replace(/[:.]/g, '-')}.json`
                  document.body.appendChild(a)
                  a.click()
                  a.remove()
                  URL.revokeObjectURL(url)
                  showToast('Exported styles', 'success')
                } catch {
                  showToast('Export failed', 'error')
                }
              }}
            >
              📤 Export
            </button>
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors"
              onClick={() => {
                setIeMenuPos(null)
                importFileInputRef.current?.click()
              }}
            >
              📥 Import from file...
            </button>
          </div>
        </>
      )}
      <input
        ref={importFileInputRef}
        type="file"
        accept=".json,.zip,application/json,application/zip"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          try {
            const res = await fetch('/style_grid/import', { method: 'POST', body: file })
            const data = await res.json().catch(() => ({}))
            if (!res.ok || data.ok === false || data.error) {
              showToast(
                typeof data.error === 'string' && data.error ? data.error : 'Import failed',
                'error',
              )
              return
            }
            const fresh = await fetch('/style_grid/styles').then((r) => r.json())
            const flat = Object.values(fresh.categories || {}).flat()
            setStyles(flat, tab)
            await fetchPresets()
            showToast('Import complete', 'success')
          } catch {
            showToast('Import failed', 'error')
          }
        }}
      />
      <Toast />
    </div>
  )
}
