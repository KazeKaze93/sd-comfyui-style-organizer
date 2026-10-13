import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Check,
  Clipboard,
  Copy,
  FolderInput,
  ImagePlus,
  Lock,
  Pencil,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import type { Style } from '../bridge'
import {
  styleRowKey,
  useCategoryColor,
  useIsSelected,
  useStyleDuplicates,
  useStylesStore,
} from '../store/stylesStore'
import { sendToHost } from '../bridge'
import { ThumbnailPreview } from './ThumbnailPreview'
import { ConfirmDialog } from './ConfirmDialog'
import { ConfirmInputDialog } from './ConfirmInputDialog'
import { EditStyleDialog } from './EditStyleDialog'

const MENU_ICON_SIZE = 14

interface Props {
  style: Style
  windowed?: boolean
}

const Portal = ({ children }: { children: React.ReactNode }) =>
  createPortal(children, document.body)

/** Suggest `${name} copy`, then `copy 2`, `copy 3`, … — same global name scope as the Duplicate collision check. */
function nextDuplicateName(baseName: string, catalog: Style[]): string {
  const taken = new Set(catalog.map((s) => s.name))
  const first = `${baseName} copy`
  if (!taken.has(first)) return first
  let n = 2
  while (taken.has(`${baseName} copy ${n}`)) n += 1
  return `${baseName} copy ${n}`
}

export const StyleCard = memo(function StyleCard({ style, windowed = false }: Props) {
  const key = useMemo(() => styleRowKey(style), [style])
  const isSelected = useIsSelected(key)
  const duplicates = useStyleDuplicates(style.name)
  const usageCount = useStylesStore(s => s.usageCounts[style.name] || 0)
  const activeSource = useStylesStore(s => s.activeSource)
  const fav = useStylesStore(s => s.favorites.has(style.name))
  const {
    toggleStyle, toggleFavorite, showToast,
    setActiveSource,
  } = useStylesStore(
    useShallow(s => ({
      toggleStyle: s.toggleStyle,
      toggleFavorite: s.toggleFavorite,
      showToast: s.showToast,
      setActiveSource: s.setActiveSource,
    }))
  )
  const [menuPos, setMenuPos] = useState<{ x: number, y: number } | null>(null)
  const [pickerPos, setPickerPos] = useState<{ x: number, y: number } | null>(null)
  const [duplicateOpen, setDuplicateOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Grid prop is the catalog row; saveStyle refetches styles[] so post-edit
  // fields stay fresh without a selectedStyles subscription.
  const displayStyle = style
  const hasMultipleSources = duplicates.length > 1
  const sourceLabels = useMemo(
    () =>
      duplicates.map((dup) =>
        ((dup.source_file || 'Unknown').split(/[\\/]/).pop() || 'Unknown')
          .replace(/\.csv$/i, '')
      ),
    [duplicates],
  )
  const pickerWidthCh = useMemo(() => {
    const maxSourceLabelLen = sourceLabels.reduce((max, label) => Math.max(max, label.length), 0)
    return Math.min(48, Math.max(18, maxSourceLabelLen + 4))
  }, [sourceLabels])

  const displayName = displayStyle.name.includes('_')
    ? displayStyle.name.split('_').slice(1).join(' ')
    : displayStyle.name

  const borderColor = useCategoryColor(displayStyle.category || 'OTHER')

  useEffect(() => {
    if (!menuPos) return
    const blockNativeContextMenu = (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
    }
    const blockRightMouseDown = (e: MouseEvent) => {
      if (e.button === 2) {
        e.preventDefault()
        e.stopPropagation()
      }
    }

    window.addEventListener('contextmenu', blockNativeContextMenu, true)
    document.addEventListener('contextmenu', blockNativeContextMenu, true)
    window.addEventListener('mousedown', blockRightMouseDown, true)
    document.addEventListener('mousedown', blockRightMouseDown, true)

    return () => {
      window.removeEventListener('contextmenu', blockNativeContextMenu, true)
      document.removeEventListener('contextmenu', blockNativeContextMenu, true)
      window.removeEventListener('mousedown', blockRightMouseDown, true)
      document.removeEventListener('mousedown', blockRightMouseDown, true)
    }
  }, [menuPos])

  return (
    <>
      <ThumbnailPreview style={displayStyle}>
        <div
          data-sg-card="true"
          title={`${displayStyle.name}\nRight-click for options`}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setMenuPos({ x: e.clientX, y: e.clientY })
          }}
          onClick={(e) => {
            if (hasMultipleSources && !activeSource && !isSelected) {
              const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
              const left = Math.min(rect.right + 8, window.innerWidth - 280)
              const top = Math.max(8, rect.top)
              setPickerPos({ x: left, y: top })
              return
            }
            toggleStyle(style)
          }}
          className={`
            relative cursor-pointer rounded-lg border ${windowed ? 'p-2' : 'p-3'}
            select-none transition-colors
            transition-transform duration-150 hover:scale-[1.02] active:scale-[0.98]
            motion-reduce:transition-none motion-reduce:transform-none
            ${isSelected
              ? 'border-sg-accent bg-sg-accent/10'
              : 'border-sg-border bg-sg-surface hover:border-sg-accent/50'}
          `}
          style={{
            borderLeftColor: isSelected ? undefined : borderColor,
            borderLeftWidth: '3px'
          }}
        >
          <div className={`${windowed ? 'text-xs' : 'text-sm'} font-medium text-sg-text truncate`}>
            {displayName}
          </div>

          {/* Selected indicator: accent border/tint + corner dot (0.0.7) */}
          {isSelected && (
            <>
              <span
                aria-hidden="true"
                className="absolute bottom-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-sg-accent"
              />
              <span className="sr-only">Selected</span>
            </>
          )}
          {usageCount > 0 && (
            <span className="absolute bottom-1.5 left-2 text-[10px] text-sg-muted font-mono">
              {usageCount > 99 ? '99+' : usageCount}
            </span>
          )}
          {fav && (
            <span className="absolute top-1.5 right-2 text-sg-warning-text">
              <Star size={12} fill="currentColor" aria-hidden="true" />
              <span className="sr-only">Favorite</span>
            </span>
          )}
        </div>
      </ThumbnailPreview>

      {menuPos && (
        <Portal>
          <div
            className="fixed z-[9999] bg-sg-surface border border-sg-border rounded-lg shadow-xl py-1 min-w-48"
            style={{ left: menuPos.x, top: menuPos.y }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <button
              className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors"
              onClick={() => { toggleStyle(style); setMenuPos(null) }}
            >
              {isSelected
                ? <><X size={MENU_ICON_SIZE} /> Deselect</>
                : <><Check size={MENU_ICON_SIZE} /> Select</>}
            </button>
            <button
              className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors"
              onClick={() => { toggleFavorite(style.name); setMenuPos(null) }}
            >
              <Star size={MENU_ICON_SIZE} fill={fav ? 'currentColor' : 'none'} />
              {fav ? 'Remove from Favorites' : 'Add to Favorites'}
            </button>
            <div className="h-px my-1 bg-sg-border" />
            <button
              className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors"
              onClick={async () => {
                setMenuPos(null)
                try {
                  await navigator.clipboard.writeText(displayStyle.prompt)
                  showToast('Prompt copied', 'success')
                } catch {
                  showToast('Copy failed', 'error')
                }
              }}
            >
              <Clipboard size={MENU_ICON_SIZE} /> Copy prompt
            </button>
            <button
              className={`w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm transition-colors ${
                displayStyle.read_only
                  ? 'opacity-45 cursor-not-allowed text-sg-muted hover:bg-transparent'
                  : 'text-sg-text hover:bg-sg-accent/20'
              }`}
              onClick={() => {
                if (displayStyle.read_only) {
                  setMenuPos(null)
                  showToast('This style is from the protected samples pack (read-only). Duplicate it into a data source to edit your own copy.', 'info')
                  return
                }
                setMenuPos(null); setEditOpen(true)
              }}
            >
              {displayStyle.read_only
                ? <><Lock size={MENU_ICON_SIZE} /> Edit</>
                : <><Pencil size={MENU_ICON_SIZE} /> Edit</>}
            </button>
            <button
              className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors"
              onClick={() => { setMenuPos(null); setDuplicateOpen(true) }}
            >
              <Copy size={MENU_ICON_SIZE} /> Duplicate
            </button>
            <button
              className={`w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm transition-colors ${
                displayStyle.read_only
                  ? 'opacity-45 cursor-not-allowed text-sg-muted hover:bg-transparent'
                  : 'text-sg-text hover:bg-sg-accent/20'
              }`}
              onClick={() => {
                if (displayStyle.read_only) {
                  setMenuPos(null)
                  showToast('This style is from the protected samples pack (read-only). Duplicate it into a data source to move your own copy.', 'info')
                  return
                }
                setMenuPos(null); setMoveOpen(true)
              }}
            >
              {displayStyle.read_only
                ? <><Lock size={MENU_ICON_SIZE} /> Move to category...</>
                : <><FolderInput size={MENU_ICON_SIZE} /> Move to category...</>}
            </button>
            <div className="h-px my-1 bg-sg-border" />
            <button
              className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors"
              onClick={() => { setMenuPos(null); fileInputRef.current?.click() }}
            >
              <ImagePlus size={MENU_ICON_SIZE} /> Upload preview image
            </button>
            {displayStyle.has_thumbnail && (
              <button
                className={`w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm transition-colors ${
                  displayStyle.read_only
                    ? 'opacity-45 cursor-not-allowed text-sg-muted hover:bg-transparent'
                    : 'text-sg-text hover:bg-sg-accent/20'
                }`}
                onClick={async () => {
                  if (displayStyle.read_only) {
                    setMenuPos(null)
                    showToast(
                      'This style is from the protected samples pack (read-only). Duplicate it into a data source to manage your own preview.',
                      'info',
                    )
                    return
                  }
                  setMenuPos(null)
                  try {
                    const params = new URLSearchParams({ name: displayStyle.name })
                    if (displayStyle.source_file) {
                      params.set('source', displayStyle.source_file)
                    }
                    const res = await fetch(`/style_grid/thumbnail?${params}`, {
                      method: 'DELETE',
                    })
                    const data = await res.json().catch(() => ({}))
                    if (!res.ok || data.ok === false || data.error) {
                      showToast(
                        typeof data.error === 'string' && data.error
                          ? data.error
                          : 'Delete preview failed',
                        'error',
                      )
                      return
                    }
                    const version = String(Date.now())
                    useStylesStore.getState().bumpThumbVersion(key, version)
                    // App's single onHostMessage also bumps via SG_THUMB_DONE.
                    window.postMessage(
                      { type: 'SG_THUMB_DONE', styleId: displayStyle.name, version, source_file: displayStyle.source_file || '' },
                      '*',
                    )
                    void useStylesStore.getState().loadThumbnails()
                    showToast('Preview deleted', 'success')
                  } catch {
                    showToast('Delete preview failed', 'error')
                  }
                }}
              >
                {displayStyle.read_only
                  ? <><Lock size={MENU_ICON_SIZE} /> Delete preview</>
                  : <><Trash2 size={MENU_ICON_SIZE} /> Delete preview</>}
              </button>
            )}
            <div className="h-px my-1 bg-sg-border" />
            <button
              className={`w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm transition-colors ${
                displayStyle.read_only
                  ? 'opacity-45 cursor-not-allowed text-sg-muted hover:bg-transparent'
                  : 'text-sg-danger-text hover:bg-sg-danger/20'
              }`}
              onClick={() => {
                setMenuPos(null)
                if (displayStyle.read_only) {
                  showToast('This style is from the protected samples pack (read-only) and cannot be deleted.', 'info')
                  return
                }
                setPendingDelete(true)
              }}
            >
              {displayStyle.read_only
                ? <><Lock size={MENU_ICON_SIZE} /> Delete</>
                : <><Trash2 size={MENU_ICON_SIZE} /> Delete</>}
            </button>
          </div>
          <div
            className="fixed inset-0 z-[9998]"
            onClick={() => setMenuPos(null)}
            onContextMenu={(e) => e.preventDefault()}
          />
        </Portal>
      )}

      {pickerPos && (
        <Portal>
          <div
            className="fixed z-[10005] bg-sg-surface border border-sg-border rounded-lg shadow-xl py-1"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              left: pickerPos.x,
              top: pickerPos.y,
              width: `${pickerWidthCh}ch`,
              minWidth: '18ch',
              maxWidth: '48ch',
            }}
          >
            {duplicates.map((dup, idx) => {
              const sourceLabel = sourceLabels[idx] || 'Unknown'
              return (
                <button
                  key={`${dup.source_file || 'unknown'}-${idx}`}
                  className="w-full text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    toggleStyle(dup)
                    setPickerPos(null)
                  }}
                >
                  <div className="font-medium truncate">{sourceLabel}</div>
                </button>
              )
            })}
          </div>
          <div
            className="fixed inset-0 z-[10004]"
            onMouseDown={() => setPickerPos(null)}
          />
        </Portal>
      )}

      {pendingDelete && (
        <Portal>
          <ConfirmDialog
            open
            title="Delete style?"
            message={`"${displayStyle.name}" will be permanently removed from the CSV.`}
            confirmLabel="Delete"
            destructive
            onCancel={() => setPendingDelete(false)}
            onConfirm={async () => {
              try {
                const res = await fetch('/style_grid/style/delete', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name: displayStyle.name, source: displayStyle.source_file }),
                })
                const data = await res.json().catch(() => ({}))
                if (!res.ok || data.ok === false) {
                  showToast(
                    typeof data.error === 'string' && data.error
                      ? data.error
                      : `Failed to delete ${displayStyle.name}`,
                    'error',
                  )
                  return
                }
                fetch(
                  `/style_grid/thumbnail?name=${encodeURIComponent(displayStyle.name)}&source=${encodeURIComponent(displayStyle.source_file || '')}`,
                  { method: 'DELETE' },
                ).catch(() => { /* best-effort, style delete already succeeded */ })
                sendToHost({ type: 'SG_UNAPPLY', styleId: displayStyle.name })
                useStylesStore.getState().removeStyleRow(displayStyle)
                showToast(`Deleted "${displayStyle.name}"`, 'success')
                setPendingDelete(false)
              } catch {
                showToast(`Failed to delete ${displayStyle.name}`, 'error')
              }
            }}
          />
        </Portal>
      )}

      {/* Lazy-mount Move/Edit/Duplicate dialogs: closed cards must not pay
          nextDuplicateName(styles) / categories() — O(N) per card (profile P). */}
      {duplicateOpen && (
        <Portal>
          <ConfirmInputDialog
            open
            title={`Duplicate "${displayStyle.name}"`}
            initialValue={nextDuplicateName(displayStyle.name, useStylesStore.getState().styles)}
            placeholder="New style name"
            confirmLabel="Duplicate"
            onCancel={() => setDuplicateOpen(false)}
            onConfirm={async (newName) => {
              // Name collision check against the current catalog — style/save
              // is an upsert, so an existing name would silently overwrite that
              // style instead of creating a new one.
              const catalog = useStylesStore.getState().styles
              const exists = catalog.some((s) => s.name === newName)
              if (exists) {
                showToast(`A style named "${newName}" already exists`, 'error')
                return  // keep dialog open so the user can retype
              }
              const result = await useStylesStore.getState().saveStyle({
                name: newName,
                prompt: displayStyle.prompt,
                negative_prompt: displayStyle.negative_prompt,
                description: displayStyle.description,
                category: displayStyle.category,
                source: displayStyle.source_file,
              })
              if (!result.ok) {
                showToast(
                  typeof result.error === 'string' && result.error
                    ? result.error
                    : 'Duplicate failed',
                  'error',
                )
                return  // keep dialog open
              }
              // style/save only returns {ok}; write path comes from the new
              // row's source_file after refetch (samples basename → data/).
              showToast(`Duplicated as "${newName}"`, 'success')
              if (displayStyle.read_only) {
                const created =
                  result.styles.find((s) => s.name === newName && !s.read_only) ??
                  result.styles.find((s) => s.name === newName)
                if (created?.source_file && created.source_file !== useStylesStore.getState().activeSource) {
                  setActiveSource(created.source_file)
                  const base = (created.source_file.replace(/\\/g, '/').split('/').pop() || created.source_file)
                    .replace(/\.csv$/i, '')
                  showToast(`Created in ${base} (data/) — switched source`, 'info')
                }
              }
              setDuplicateOpen(false)
            }}
          />
        </Portal>
      )}

      {moveOpen && (
        <Portal>
          <ConfirmInputDialog
            open
            title={`Move "${displayStyle.name}" to category`}
            initialValue={displayStyle.category}
            placeholder="Category name"
            confirmLabel="Move"
            suggestions={useStylesStore
              .getState()
              .categories()
              .filter((c) => c !== displayStyle.category)}
            onCancel={() => setMoveOpen(false)}
            onConfirm={async (newCategory) => {
              if (newCategory === displayStyle.category) {
                setMoveOpen(false)
                return
              }
              const result = await useStylesStore.getState().saveStyle({
                name: displayStyle.name,
                prompt: displayStyle.prompt,
                negative_prompt: displayStyle.negative_prompt,
                description: displayStyle.description,
                category: newCategory,
                source: displayStyle.source_file,
              })
              if (!result.ok) {
                showToast(
                  typeof result.error === 'string' && result.error
                    ? result.error
                    : 'Move failed',
                  'error',
                )
                return
              }
              showToast(`Moved "${displayStyle.name}" to "${newCategory}"`, 'success')
              setMoveOpen(false)
            }}
          />
        </Portal>
      )}

      {editOpen && (
        <Portal>
          <EditStyleDialog
            open
            style={displayStyle}
            categories={useStylesStore
              .getState()
              .categories()
              .filter((c) => c !== displayStyle.category)}
            onCancel={() => setEditOpen(false)}
            onSave={async (fields) => {
              const result = await useStylesStore.getState().saveStyle({
                name: displayStyle.name,
                prompt: fields.prompt,
                negative_prompt: fields.negative_prompt,
                description: fields.description,
                category: fields.category,
                source: displayStyle.source_file,
              })
              if (!result.ok) {
                showToast(
                  typeof result.error === 'string' && result.error
                    ? result.error
                    : 'Save failed',
                  'error',
                )
                return  // keep dialog open so edits aren't lost
              }

              // styles[] is fresh; selectedStyles still holds the pre-edit
              // Style objects (detectConflicts / re-apply would read stale
              // prompt/neg). Patch matching selection rows from the refetch.
              const updated =
                result.styles.find(
                  (s) =>
                    s.name === displayStyle.name &&
                    s.source_file === displayStyle.source_file,
                ) ?? {
                  ...displayStyle,
                  prompt: fields.prompt,
                  negative_prompt: fields.negative_prompt,
                  description: fields.description,
                  category: fields.category,
                }
              const wasSelected = useStylesStore.getState().selectedKeySet.has(key)
              useStylesStore.setState((s) => ({
                selectedStyles: s.selectedStyles.map((row) =>
                  row.name === displayStyle.name &&
                  row.source_file === displayStyle.source_file
                    ? updated
                    : row,
                ),
              }))
              // Host keeps apply-time prompt/neg in a ledger and in the
              // node widgets — nothing else refreshes them on edit. Swap
              // so the canvas text matches the saved style.
              if (wasSelected) {
                sendToHost({ type: 'SG_UNAPPLY', styleId: displayStyle.name })
                sendToHost({
                  type: 'SG_APPLY',
                  styleId: displayStyle.name,
                  prompt: updated.prompt,
                  neg: updated.negative_prompt,
                })
              }
              useStylesStore.getState().detectConflicts()

              showToast(`Saved "${displayStyle.name}"`, 'success')
              setEditOpen(false)
            }}
          />
        </Portal>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''  // allow re-selecting the same file later
          if (!file) return
          if (file.size > 10 * 1024 * 1024) {
            showToast('Image must be under 10MB', 'error')
            return
          }
          const reader = new FileReader()
          reader.onload = async () => {
            try {
              const res = await fetch('/style_grid/thumbnail/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  name: displayStyle.name,
                  source: displayStyle.source_file,
                  image: reader.result,
                }),
              })
              const data = await res.json().catch(() => ({}))
              if (!res.ok || data.ok === false || data.error) {
                showToast(
                  typeof data.error === 'string' && data.error
                    ? data.error
                    : 'Upload failed',
                  'error',
                )
                return
              }
              const version = String(Date.now())
              useStylesStore.getState().bumpThumbVersion(key, version)
              // App's single onHostMessage also bumps via SG_THUMB_DONE.
              window.postMessage(
                { type: 'SG_THUMB_DONE', styleId: displayStyle.name, version, source_file: displayStyle.source_file || '' },
                '*',
              )
              void useStylesStore.getState().loadThumbnails()
              showToast('Preview updated', 'success')
            } catch {
              showToast('Upload failed', 'error')
            }
          }
          reader.onerror = () => showToast('Failed to read image file', 'error')
          reader.readAsDataURL(file)
        }}
      />
    </>
  )
})
