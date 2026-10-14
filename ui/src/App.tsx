import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  Save, Import, Eraser, Rows3, ChevronsUpDown, ChevronsDownUp, Plus,
  Palette, AlertTriangle, Maximize2, Minimize2, X, Upload, Download,
  type LucideIcon,
} from 'lucide-react'
import { onHostMessage, sendToHost, type Style } from './bridge'
import { appliedThemeMode, applyThemeMode, parseThemeMode } from './lib/themeMode'
import { closeTopLayer, useLayer } from './lib/layerStack'
import { styleRowKey, useStylesStore } from './store/stylesStore'
import { SearchBar } from './components/SearchBar'
import { SourceFilter } from './components/SourceFilter'
import { Sidebar } from './components/Sidebar'
import { StyleGrid } from './components/StyleGrid'
import { BottomPanel } from './components/BottomPanel'
import { Toast } from './components/Toast'
import { EditStyleDialog } from './components/EditStyleDialog'
import { MenuItem, ViewportFixedMenu } from './components/ViewportFixedMenu'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './components/ui/popover'
import { cn } from './lib/utils'

const WINDOWED_SIZE_KEY = 'sg_windowed_size'

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent focus-visible:ring-offset-1 focus-visible:ring-offset-sg-bg'

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return target.isContentEditable
}

function clearSearchField(searchRoot: HTMLElement | null): boolean {
  const { search, setSearch } = useStylesStore.getState()
  const input = searchRoot?.querySelector('input')
  const hasText =
    (typeof search === 'string' && search.length > 0) ||
    (!!input && input.value.length > 0)
  if (!hasText) return false
  setSearch('')
  if (input) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set
    setter?.call(input, '')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  return true
}

/** Response shape for `GET /style_grid/styles`. */
type StylesResponse = { categories?: Record<string, Style[]> }

/**
 * Native title only — Radix Tooltip + Floating UI getOverflowAncestors stack-overflows
 * when bench/host installs a fake `window.frameElement` that is an ancestor of #root
 * (body → frameElement → host → body). Focus/Tab into toolbar must not open Floating UI.
 */
const ToolBtn = ({
  icon: Icon,
  label,
  title,
  onClick,
  disabled,
  colorClassName,
  active,
}: {
  icon: LucideIcon
  label: string
  title?: string
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  colorClassName?: string
  active?: boolean
}) => (
  <button
    type="button"
    onClick={disabled ? undefined : onClick}
    disabled={disabled}
    title={title ?? label}
    aria-label={label}
    aria-pressed={active !== undefined ? active : undefined}
    className={cn(
      'w-8 h-8 flex items-center justify-center rounded transition-colors border',
      FOCUS_RING,
      disabled
        ? 'opacity-45 cursor-not-allowed text-sg-muted border-transparent [filter:grayscale(0.35)]'
        : active
          ? 'bg-sg-accent/15 border-sg-accent/40 text-sg-text'
          : cn(
              colorClassName ?? 'text-sg-muted',
              'hover:text-sg-text hover:bg-sg-surface border-transparent hover:border-sg-border',
            ),
    )}
  >
    <Icon size={16} aria-hidden />
  </button>
)

function SelectedCountBadge() {
  const selectedCount = useStylesStore((s) => s.selectedStyles.length)
  if (selectedCount === 0) return null
  return (
    <span className="text-xs text-sg-muted">
      {selectedCount} selected
    </span>
  )
}

/** Isolated: conflicts set() must not re-render the whole App chrome (profile P). */
function ConflictsChip() {
  const [conflictsOpen, setConflictsOpen] = useState(false)
  const conflicts = useStylesStore((s) => s.conflicts)
  const toggleStyle = useStylesStore((s) => s.toggleStyle)
  useLayer(conflictsOpen, () => setConflictsOpen(false))
  if (conflicts.length === 0) return null

  return (
    <Popover open={conflictsOpen} onOpenChange={setConflictsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${conflicts.length} style conflicts`}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded',
            'bg-sg-danger/20 border border-sg-danger/40',
            'text-sg-danger-text text-xs',
            'motion-safe:animate-pulse',
            FOCUS_RING,
          )}
        >
          <AlertTriangle size={14} aria-hidden />
          {conflicts.length}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        onEscapeKeyDown={(e) => e.preventDefault()}
        className="w-auto min-w-64 max-w-[min(20rem,calc(100vw-2.5rem))] p-3 bg-sg-popover border border-sg-border rounded-lg shadow-xl"
      >
        <div className="text-xs font-semibold text-sg-text mb-2">
          Style Conflicts
        </div>
        {conflicts.map((c, i) => {
          const { selectedStyles, styles } = useStylesStore.getState()
          const conflictingStyle = selectedStyles.find(s => styleRowKey(s) === c.styleBKey)
            ?? styles.find(s => styleRowKey(s) === c.styleBKey)
          return (
            <div key={i} className="flex items-start justify-between gap-2 py-0.5">
              <span className="text-xs text-sg-danger-text min-w-0 flex-1 break-words">
                {c.reason}
              </span>
              {conflictingStyle && (
                <button
                  type="button"
                  onClick={() => {
                    toggleStyle(conflictingStyle)
                    setConflictsOpen(false)
                  }}
                  className={cn(
                    'text-xs px-1.5 py-0.5 rounded border',
                    'border-sg-danger/40 text-sg-danger-text hover:bg-sg-danger/20',
                    'transition-colors shrink-0',
                    FOCUS_RING,
                  )}
                  title={`Remove "${c.styleB}"`}
                  aria-label={`Remove "${c.styleB}"`}
                >
                  ✕
                </button>
              )}
            </div>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}

export default function App() {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [newStyleOpen, setNewStyleOpen] = useState(false)
  const [ieMenu, setIeMenu] = useState<{
    x: number
    y: number
    restore: HTMLElement
  } | null>(null)
  const importFileInputRef = useRef<HTMLInputElement>(null)
  const searchRootRef = useRef<HTMLDivElement>(null)
  // Narrow slice — avoid selectedStyles/conflicts fan-out on every toggle (profile P).
  const {
    setStyles,
    styles,
    toggleCompact,
    compactMode,
    collapsedCategories,
    collapseAll,
    expandAll,
    showToast,
    fetchPresets,
    activeSource,
    setActiveSource,
    categories,
    presetsCorrupt,
  } = useStylesStore(
    useShallow((s) => ({
      setStyles: s.setStyles,
      styles: s.styles,
      toggleCompact: s.toggleCompact,
      compactMode: s.compactMode,
      collapsedCategories: s.collapsedCategories,
      collapseAll: s.collapseAll,
      expandAll: s.expandAll,
      showToast: s.showToast,
      fetchPresets: s.fetchPresets,
      activeSource: s.activeSource,
      setActiveSource: s.setActiveSource,
      categories: s.categories,
      presetsCorrupt: s.presetsCorrupt,
    })),
  )
  const activeSourceIsReadOnly = !!activeSource &&
    styles.some(s => s.source_file === activeSource && s.read_only)

  useEffect(() => {
    void useStylesStore.getState().loadCategoryOrder()
    useStylesStore.getState().setThemeMode(appliedThemeMode())
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
      if (msg.type === 'SG_THEME') {
        const mode = parseThemeMode(msg.mode)
        applyThemeMode(mode)
        useStylesStore.getState().setThemeMode(mode)
      }
      if (msg.type === 'SG_CLOSE') {
        sendToHost({ type: 'SG_CLOSE_REQUEST' })
      }
      if (msg.type === 'SG_CLEAR_SELECTION') {
        useStylesStore.getState().clearSelectionChrome()
      }
      if (msg.type === 'SG_STYLE_APPLIED') {
        const { selectedStyles, detectConflicts } = useStylesStore.getState()
        const exists = selectedStyles.some(s => styleRowKey(s) === styleRowKey(msg.style))
        if (!exists) {
          useStylesStore.getState().setSelectedStyles([...selectedStyles, msg.style])
          detectConflicts()
        }
      }
      if (msg.type === 'SG_WILDCARDS_ACTIVE') {
        useStylesStore.getState().setActiveWildcards(msg.categories)
      }
      if (msg.type === 'SG_THUMB_DONE') {
        useStylesStore.getState().bumpThumbVersion(
          styleRowKey({ name: msg.styleId, source_file: msg.source_file }),
          String(msg.version),
        )
      }
    })
    sendToHost({ type: 'SG_READY' })
    return unsub
  }, [setStyles])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (closeTopLayer()) {
          e.preventDefault()
          e.stopPropagation()
          return
        }
        if (clearSearchField(searchRootRef.current)) {
          e.preventDefault()
          e.stopPropagation()
          return
        }
        sendToHost({ type: 'SG_CLOSE_REQUEST' })
        return
      }

      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (isEditableTarget(e.target)) return
        e.preventDefault()
        searchRootRef.current?.querySelector('input')?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  useEffect(() => {
    let cancelled = false
    let attempts = 0
    const focusFirstCell = () => {
      if (cancelled) return
      const cell = document.querySelector<HTMLElement>('[data-sg-card]')
      if (cell) {
        cell.focus()
        return
      }
      attempts += 1
      if (attempts < 30) {
        window.setTimeout(focusFirstCell, 50)
      }
    }
    const raf = requestAnimationFrame(focusFirstCell)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
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
        <span className="text-sg-accent font-semibold inline-flex items-center gap-1.5">
          <Palette size={16} aria-hidden />
          Style Grid
        </span>
        <SourceFilter />
        <div className="flex-1" ref={searchRootRef}>
          <SearchBar />
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <ToolBtn
            icon={Save}
            label="Backup (CSVs + presets)"
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
            onClick={(e) => {
              const opener = e.currentTarget
              const rect = opener.getBoundingClientRect()
              setIeMenu({ x: rect.left, y: rect.bottom + 4, restore: opener })
            }}
          />
          <div className="w-px h-5 bg-sg-border mx-0.5 self-center" />
          <ToolBtn
            icon={Eraser}
            label="Clear all selected styles"
            colorClassName="text-sg-danger-text"
            onClick={() => {
              sendToHost({ type: 'SG_CLEAR_ALL' })
            }}
          />
          <div className="w-px h-5 bg-sg-border mx-0.5 self-center" />
          <ToolBtn
            icon={Rows3}
            label="Compact mode"
            active={compactMode}
            onClick={() => toggleCompact()}
          />
          <ToolBtn
            icon={collapsedCategories.size > 0 ? ChevronsUpDown : ChevronsDownUp}
            label={collapsedCategories.size > 0 ? 'Expand all' : 'Collapse all'}
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
            colorClassName="text-sg-accent-text"
            disabled={!activeSource || activeSourceIsReadOnly}
            onClick={() => {
              // samples/ is write-protected — style/save rematerializes to
              // data/<basename>.csv. Tell the user before they fill the form.
              setNewStyleOpen(true)
            }}
          />
          <SelectedCountBadge />
          <ConflictsChip />
          <ToolBtn
            icon={isFullscreen ? Minimize2 : Maximize2}
            label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            onClick={toggleFullscreen}
          />
          <span className="ml-3 inline-flex">
            <ToolBtn
              icon={X}
              label="Close Style Grid"
              onClick={() => sendToHost({ type: 'SG_CLOSE_REQUEST' })}
            />
          </span>
        </div>
      </div>

      {presetsCorrupt && (
        <div
          role="alert"
          className="shrink-0 px-4 py-3 border-b border-sg-danger/50 bg-sg-danger/90 text-white text-sm"
        >
          <div className="font-semibold">presets.json is corrupt — preset saves are disabled</div>
          <div className="mt-1 font-mono text-xs break-all opacity-90">
            file: {presetsCorrupt.path}
          </div>
          <div className="font-mono text-xs break-all opacity-90">
            backup: {presetsCorrupt.bakPath}
          </div>
          <div className="mt-1 text-xs opacity-80">
            Restore the <code className="font-mono">.bak</code> over{' '}
            <code className="font-mono">presets.json</code>, then reopen Style Grid.
            Do not create new presets until this is fixed — that would overwrite history.
          </div>
        </div>
      )}

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
      {newStyleOpen && (
        <EditStyleDialog
          open
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
      )}
      {ieMenu && (
        <ViewportFixedMenu
          x={ieMenu.x}
          y={ieMenu.y}
          onClose={() => setIeMenu(null)}
          restoreFocusTo={ieMenu.restore}
        >
          <MenuItem
            onSelect={() => {
              setIeMenu(null)
              void (async () => {
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
              })()
            }}
          >
            <span className="inline-flex items-center gap-2">
              <Download size={14} aria-hidden />
              Export
            </span>
          </MenuItem>
          <MenuItem
            onSelect={() => {
              setIeMenu(null)
              importFileInputRef.current?.click()
            }}
          >
            <span className="inline-flex items-center gap-2">
              <Upload size={14} aria-hidden />
              Import from file...
            </span>
          </MenuItem>
        </ViewportFixedMenu>
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
