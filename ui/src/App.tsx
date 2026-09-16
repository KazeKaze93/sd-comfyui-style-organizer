import { useEffect, useRef, useState, type MouseEvent } from 'react'
import {
  Save, Import, Eraser, Rows3, ChevronsUpDown, Plus,
  type LucideIcon,
} from 'lucide-react'
import { onHostMessage, sendToHost, type Style } from './bridge'
import { useStylesStore } from './store/stylesStore'
import { SearchBar } from './components/SearchBar'
import { SourceFilter } from './components/SourceFilter'
import { Sidebar } from './components/Sidebar'
import { StyleGrid } from './components/StyleGrid'
import { BottomPanel } from './components/BottomPanel'
import { Toast } from './components/Toast'
import { EditStyleDialog } from './components/EditStyleDialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './components/ui/tooltip'
import { cn } from './lib/utils'

const WINDOWED_SIZE_KEY = 'sg_windowed_size'

/** Response shape for `GET /style_grid/styles`. */
type StylesResponse = { categories?: Record<string, Style[]> }

const ToolBtn = ({
  icon: Icon,
  label,
  title,
  onClick,
  disabled,
  colorClassName,
}: {
  icon: LucideIcon
  label: string
  title?: string
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  colorClassName?: string
}) => {
  const button = (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      className={cn(
        'w-8 h-8 flex items-center justify-center rounded transition-colors border',
        disabled
          ? 'opacity-45 cursor-not-allowed text-sg-muted border-transparent [filter:grayscale(0.35)]'
          : cn(
              colorClassName ?? 'text-sg-muted',
              'hover:text-sg-text hover:bg-sg-surface border-transparent hover:border-sg-border',
            ),
      )}
    >
      <Icon size={16} />
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
  const [newStyleOpen, setNewStyleOpen] = useState(false)
  const [ieMenuPos, setIeMenuPos] = useState<{ x: number; y: number } | null>(null)
  const importFileInputRef = useRef<HTMLInputElement>(null)
  const {
    setStyles,
    selectedStyles,
    styles,
    conflicts,
    toggleStyle,
    toggleCompact,
    collapsedCategories,
    collapseAll,
    expandAll,
    showToast,
    fetchPresets,
    activeSource,
    setActiveSource,
    categories,
  } = useStylesStore()

  const activeSourceIsReadOnly = !!activeSource &&
    styles.some(s => s.source_file === activeSource && s.read_only)

  useEffect(() => {
    useStylesStore.getState().loadUsage()
    void useStylesStore.getState().loadCategoryOrder()
    const unsub = onHostMessage((msg) => {
      if (msg.type === 'SG_INIT') {
        const raw: unknown = (msg as { styles?: unknown }).styles
        const arr = Array.isArray(raw)
          ? raw
          : Array.isArray((raw as { styles?: unknown[] } | null)?.styles)
            ? (raw as { styles: unknown[] }).styles
            : (raw as { categories?: Record<string, unknown[]> } | null)?.categories
              ? Object.values((raw as { categories: Record<string, unknown[]> }).categories).flat()
              : []
        setStyles(arr)
        void useStylesStore.getState().fetchPresets()
      }
      if (msg.type === 'SG_CLOSE') {
        sendToHost({ type: 'SG_CLOSE_REQUEST' })
      }
      if (msg.type === 'SG_CLEAR_SELECTION') {
        useStylesStore.setState({
          selectedStyles: [],
          conflicts: [],
          activeWildcards: [],
          activePresetName: null,
          styleContributors: {},
        })
      }
      if (msg.type === 'SG_STYLE_APPLIED') {
        const { selectedStyles, detectConflicts } = useStylesStore.getState()
        const exists = selectedStyles.some(s => s.name === msg.style.name)
        if (!exists) {
          useStylesStore.getState().setSelectedStyles([...selectedStyles, msg.style])
          detectConflicts()
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
      let saved: { top?: string; right?: string; width?: string; height?: string } = {}
      try {
        const raw = localStorage.getItem(WINDOWED_SIZE_KEY)
        if (raw) saved = JSON.parse(raw)
      } catch { /* ignore malformed/unavailable storage */ }

      // Windowed mode (master-like): centered and readable
      wrapper.style.top = saved.top || '80px'
      wrapper.style.right = saved.right || '16px'
      wrapper.style.left = 'auto'
      wrapper.style.transform = 'none'
      wrapper.style.width = saved.width || '1000px'
      wrapper.style.height = saved.height || '650px'
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

    try {
      localStorage.setItem(WINDOWED_SIZE_KEY, JSON.stringify({
        top: wrapper.style.top,
        right: wrapper.style.right,
        width: wrapper.style.width,
        height: wrapper.style.height,
      }))
    } catch { /* ignore storage unavailable */ }

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
            <ToolBtn
              icon={Save}
              label="Backup (CSVs + presets)"
              colorClassName="text-blue-400/80"
              onClick={async () => {
                try {
                  const res = await fetch('/style_grid/backup', { method: 'POST' })
                  const data = await res.json().catch(() => ({}))
                  if (data.empty === true) {
                    showToast('Nothing to back up', 'info')
                    return
                  }
                  if (!res.ok || data.ok === false || data.error) {
                    showToast(
                      typeof data.error === 'string' && data.error
                        ? data.error
                        : 'Backup failed',
                      'error',
                    )
                    return
                  }
                  const file =
                    typeof data.file === 'string' && data.file ? data.file : ''
                  showToast(
                    file ? `Backup created: ${file}` : 'Backup created',
                    'success',
                  )
                } catch {
                  showToast('Backup failed', 'error')
                }
              }}
            />
            <ToolBtn
              icon={Import}
              label="Import/Export"
              colorClassName="text-blue-400/80"
              onClick={(e) => {
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                setIeMenuPos({ x: rect.left, y: rect.bottom + 4 })
              }}
            />
            <div className="w-px h-5 bg-sg-border mx-0.5 self-center" />
            <ToolBtn
              icon={Eraser}
              label="Clear all selected styles"
              title="Clear all selected styles"
              colorClassName="text-red-400/80"
              onClick={() => {
                sendToHost({ type: 'SG_CLEAR_ALL' })
              }}
            />
            <div className="w-px h-5 bg-sg-border mx-0.5 self-center" />
            <ToolBtn
              icon={Rows3}
              label="Compact mode"
              colorClassName="text-violet-300/80"
              onClick={() => toggleCompact()}
            />
            <ToolBtn
              icon={ChevronsUpDown}
              label="Collapse all"
              colorClassName="text-violet-300/80"
              onClick={() =>
                collapsedCategories.size > 0 ? expandAll() : collapseAll()
              }
            />
            <div className="w-px h-5 bg-sg-border mx-0.5 self-center" />
            <ToolBtn
              icon={Plus}
              label={
                !activeSource
                  ? 'Select a specific CSV source before creating a style'
                  : activeSourceIsReadOnly
                    ? 'This source is read-only (bundled samples). Pick or import another CSV to add styles.'
                    : 'New style'
              }
              colorClassName="text-emerald-400/80"
              disabled={!activeSource || activeSourceIsReadOnly}
              onClick={() => {
                // samples/ is write-protected — style/save rematerializes to
                // data/<basename>.csv. Tell the user before they fill the form.
                setNewStyleOpen(true)
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

      {/* Bottom panel — single height transition */}
      <div className="shrink-0">
        <BottomPanel />
      </div>
      <EditStyleDialog
        open={newStyleOpen}
        nameEditable
        style={{ name: '', description: '', category: '', prompt: '', negative_prompt: '' }}
        categories={categories()}
        onCancel={() => setNewStyleOpen(false)}
        onSave={async (fields) => {
          if (styles.some((s) => s.name === fields.name)) {
            showToast(`A style named "${fields.name}" already exists`, 'error')
            return
          }
          // style/save returns {ok} only — resolve the real write target
          // from the created row after refetch (samples → data/<basename>).
          const fromSamples = styles.some(
            (s) => s.source_file === activeSource && s.read_only,
          )
          const result = await useStylesStore.getState().saveStyle({
            name: fields.name,
            prompt: fields.prompt,
            negative_prompt: fields.negative_prompt,
            description: fields.description,
            category: fields.category,
            source: activeSource,
          })
          if (!result.ok) {
            showToast(
              typeof result.error === 'string' && result.error ? result.error : 'Create failed',
              'error',
            )
            return
          }
          showToast(`Created "${fields.name}"`, 'success')
          if (fromSamples) {
            const created =
              result.styles.find((s) => s.name === fields.name && !s.read_only) ??
              result.styles.find((s) => s.name === fields.name)
            if (created?.source_file && created.source_file !== useStylesStore.getState().activeSource) {
              setActiveSource(created.source_file)
              const base = (created.source_file.replace(/\\/g, '/').split('/').pop() || created.source_file)
                .replace(/\.csv$/i, '')
              showToast(`Created in ${base} (data/) — switched source`, 'info')
            }
          }
          setNewStyleOpen(false)
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
            const stylesN = Number(data.imported) || 0
            const presetsN = Number(data.presets_imported) || 0
            const fresh: StylesResponse = await fetch('/style_grid/styles').then((r) => r.json())
            const flat = Object.values(fresh.categories || {}).flat()
            setStyles(flat)
            await fetchPresets()
            showToast(`Imported ${stylesN} styles, ${presetsN} presets`, 'success')
          } catch {
            showToast('Import failed', 'error')
          }
        }}
      />
      <Toast />
    </div>
  )
}
