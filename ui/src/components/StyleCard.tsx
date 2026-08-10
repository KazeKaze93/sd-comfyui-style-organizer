import { memo, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { useShallow } from 'zustand/react/shallow'
import type { Style } from '../bridge'
import { getCategoryColor, useStylesStore } from '../store/stylesStore'
import { sendToHost } from '../bridge'
import { ThumbnailPreview } from './ThumbnailPreview'
import { ConfirmInputDialog } from './ConfirmInputDialog'
import { EditStyleDialog } from './EditStyleDialog'

interface Props {
  style: Style
  windowed?: boolean
  /** When set, card acts as a saved preset: click loads preset; no selection/thumbnail menu behavior. */
  presetName?: string
}

const Portal = ({ children }: { children: React.ReactNode }) =>
  createPortal(children, document.body)

export const StyleCard = memo(function StyleCard({ style, windowed = false, presetName }: Props) {
  const {
    selectedStyles, toggleStyle, toggleFavorite, usageCounts, styles, activeSource, showToast, categories,
    presets, clearAll, activePresetName, deletePreset,
  } = useStylesStore(
    useShallow(s => ({
      selectedStyles: s.selectedStyles,
      toggleStyle: s.toggleStyle,
      toggleFavorite: s.toggleFavorite,
      usageCounts: s.usageCounts,
      styles: s.styles,
      activeSource: s.activeSource,
      showToast: s.showToast,
      categories: s.categories,
      presets: s.presets,
      clearAll: s.clearAll,
      activePresetName: s.activePresetName,
      deletePreset: s.deletePreset,
    }))
  )
  const fav = useStylesStore(s => s.favorites.has(style.name))
  const [menuPos, setMenuPos] = useState<{ x: number, y: number } | null>(null)
  const [pickerPos, setPickerPos] = useState<{ x: number, y: number } | null>(null)
  const [duplicateOpen, setDuplicateOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isSelected = !presetName && selectedStyles.some(s => s.name === style.name)
  const isPresetActive = Boolean(presetName && activePresetName === presetName)
  const cardActive = presetName ? isPresetActive : isSelected
  // When the picker applied a non-first-wins pack, render that row's meta
  // (thumb/prompt/read_only) instead of the deduped grid prop.
  const selectedForName = selectedStyles.find(s => s.name === style.name)
  const displayStyle = selectedForName ?? style
  const usageCount = usageCounts[style.name] || 0
  const presetMembers = presetName ? (presets[presetName]?.styles ?? []) : []
  const presetTotal = presetMembers.length
  const presetFound = presetMembers.filter((n) =>
    styles.some((st) => st.name === n),
  ).length
  const presetCountLabel =
    presetTotal === 0
      ? '0 styles'
      : presetFound < presetTotal
        ? `${presetFound}/${presetTotal} styles`
        : `${presetTotal} styles`
  const duplicates = styles.filter(s => s.name === style.name)
  const hasMultipleSources = duplicates.length > 1
  const sourceLabels = duplicates.map((dup) =>
    ((dup.source_file || 'Unknown').split(/[\\/]/).pop() || 'Unknown')
      .replace(/\.csv$/i, '')
  )
  const maxSourceLabelLen = sourceLabels.reduce((max, label) => Math.max(max, label.length), 0)
  const pickerWidthCh = Math.min(48, Math.max(18, maxSourceLabelLen + 4))

  const displayName = displayStyle.name.includes('_')
    ? displayStyle.name.split('_').slice(1).join(' ')
    : displayStyle.name

  const borderColor = getCategoryColor(displayStyle.category || 'OTHER')

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
      <ThumbnailPreview style={displayStyle} presetName={presetName}>
        <motion.div
          data-sg-card="true"
          title={presetName ? undefined : displayStyle.name}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.1 }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onContextMenu={(e) => {
            if (presetName) {
              e.preventDefault()
              e.stopPropagation()
              return
            }
            e.preventDefault()
            e.stopPropagation()
            setMenuPos({ x: e.clientX, y: e.clientY })
          }}
          onClick={(e) => {
            if (presetName) {
              // Card CRUD: load (click) / unload / delete (✕). Rename, reorder, inspect-members intentionally out of scope.
              const preset = presets[presetName]
              if (!preset) return
              // Identity signal, not set-equality: partial/ghost members never
              // make isFullyLoaded true, so unload would be unreachable.
              if (activePresetName === presetName) {
                clearAll()
                return
              }
              clearAll()
              let loaded = 0
              const total = preset.styles.length
              const toLoad: Style[] = []
              preset.styles.forEach((n) => {
                // Name-only by design (same as Favorites/Recent): first-wins on cross-CSV duplicates.
                const s = styles.find((st) => st.name === n)
                if (s) toLoad.push(s)
              })
              loaded = toLoad.length
              // Bulk: bump usage, not client Recent MRU (same split as selectAllInCategory / Recent P1).
              const store = useStylesStore.getState()
              store.setSelectedStyles(toLoad)
              toLoad.forEach((s) => {
                store.incrementUsage(s.name)
                sendToHost({
                  type: 'SG_APPLY',
                  styleId: s.name,
                  prompt: s.prompt,
                  neg: s.negative_prompt,
                })
              })
              store.detectConflicts()
              useStylesStore.setState({ activePresetName: presetName })
              const missing = total - loaded
              if (missing > 0) {
                showToast(
                  `Loaded ${loaded} of ${total} styles (${missing} missing)`,
                  'info',
                )
              }
              return
            }
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
            transition-colors duration-150 select-none
            ${cardActive
              ? 'border-sg-accent bg-sg-accent/10'
              : 'border-sg-border bg-sg-surface hover:border-sg-accent/50'}
          `}
          style={{
            borderLeftColor: cardActive ? undefined : borderColor,
            borderLeftWidth: '3px'
          }}
        >
          <div className={`${windowed ? 'text-xs' : 'text-sm'} font-medium text-sg-text truncate`}>
            {displayName}
          </div>

          {/* Selected indicator */}
          {cardActive && (
            <div className="absolute bottom-2 right-2 w-2 h-2
                            rounded-full bg-sg-accent" />
          )}
          {!presetName && usageCount > 0 && (
            <span className="absolute bottom-1.5 left-2 text-[10px] 
                     text-sg-muted/60 font-mono">
              {usageCount > 99 ? '99+' : usageCount}
            </span>
          )}
          {presetName && (
            <span
              className="absolute bottom-1.5 left-2 text-[10px] text-sg-muted/60 font-mono truncate max-w-[calc(100%-1.5rem)]"
              title={presetCountLabel}
            >
              {presetCountLabel}
            </span>
          )}
          {!presetName && fav && (
            <span
              className="absolute top-1.5 right-2 text-[10px] text-sg-muted/60"
              aria-hidden
            >
              ★
            </span>
          )}
          {presetName && (
            <button
              type="button"
              onClick={async (e) => {
                e.stopPropagation()
                if (!window.confirm(`Delete preset "${presetName}"?`)) return
                const result = await deletePreset(presetName)
                if (!result.ok) {
                  showToast(
                    typeof result.error === 'string' && result.error
                      ? result.error
                      : 'Delete preset failed',
                    'error',
                  )
                  return
                }
                showToast(`Deleted preset "${presetName}"`, 'success')
              }}
              className="absolute top-1 right-1 w-4 h-4 flex items-center justify-center rounded-full text-sg-muted hover:bg-red-500/20 hover:text-red-400 transition-colors"
              title="Delete preset"
            >
              ✕
            </button>
          )}
        </motion.div>
      </ThumbnailPreview>

      {menuPos && (
        <Portal>
          <div
            className="fixed z-[9999] bg-sg-surface border border-sg-border rounded-lg shadow-xl py-1 min-w-48"
            style={{ left: menuPos.x, top: menuPos.y }}
            onMouseLeave={() => setMenuPos(null)}
            onContextMenu={(e) => e.preventDefault()}
          >
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors"
              onClick={() => { toggleStyle(style); setMenuPos(null) }}
            >
              {isSelected ? '✕ Deselect' : '✓ Select'}
            </button>
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors"
              onClick={() => { toggleFavorite(style.name); setMenuPos(null) }}
            >
              {fav ? '★ Remove from Favorites' : '☆ Add to Favorites'}
            </button>
            <div className="h-px my-1 bg-sg-border" />
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors"
              onClick={() => { navigator.clipboard.writeText(displayStyle.prompt); setMenuPos(null) }}
            >
              📋 Copy prompt
            </button>
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors"
              onClick={() => {
                if (displayStyle.read_only) {
                  setMenuPos(null)
                  showToast('This style is from the protected samples pack (read-only). Duplicate it into a data source to edit your own copy.', 'info')
                  return
                }
                setMenuPos(null); setEditOpen(true)
              }}
            >
              ✏️ Edit
            </button>
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors"
              onClick={() => { setMenuPos(null); setDuplicateOpen(true) }}
            >
              📄 Duplicate
            </button>
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors"
              onClick={() => {
                if (displayStyle.read_only) {
                  setMenuPos(null)
                  showToast('This style is from the protected samples pack (read-only). Duplicate it into a data source to move your own copy.', 'info')
                  return
                }
                setMenuPos(null); setMoveOpen(true)
              }}
            >
              📂 Move to category...
            </button>
            <div className="h-px my-1 bg-sg-border" />
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors"
              onClick={() => { setMenuPos(null); fileInputRef.current?.click() }}
            >
              🖼️ Upload preview image
            </button>
            <div className="h-px my-1 bg-sg-border" />
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/20 transition-colors"
              onClick={async () => {
                setMenuPos(null)
                if (displayStyle.read_only) {
                  showToast('This style is from the protected samples pack (read-only) and cannot be deleted.', 'info')
                  return
                }
                if (!window.confirm(`Delete "${displayStyle.name}"? This cannot be undone.`)) return
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
                  sendToHost({ type: 'SG_UNAPPLY', styleId: displayStyle.name })
                  if (selectedStyles.some((s) => s.name === displayStyle.name)) {
                    useStylesStore.setState((state) => ({
                      selectedStyles: state.selectedStyles.filter((s) => s.name !== displayStyle.name),
                    }))
                  }
                  useStylesStore.setState((state) => ({
                    styles: state.styles.filter((s) => s.name !== displayStyle.name),
                  }))
                  showToast(`Deleted "${displayStyle.name}"`, 'success')
                } catch {
                  showToast(`Failed to delete ${displayStyle.name}`, 'error')
                }
              }}
            >
              🗑️ Delete
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

      <Portal>
        <ConfirmInputDialog
          open={duplicateOpen}
          title={`Duplicate "${displayStyle.name}"`}
          initialValue={`${displayStyle.name} copy`}
          placeholder="New style name"
          confirmLabel="Duplicate"
          onCancel={() => setDuplicateOpen(false)}
          onConfirm={async (newName) => {
            // Name collision check against the current catalog — style/save
            // is an upsert, so an existing name would silently overwrite that
            // style instead of creating a new one.
            const exists = styles.some((s) => s.name === newName)
            if (exists) {
              showToast(`A style named "${newName}" already exists`, 'error')
              return  // keep dialog open so the user can retype
            }
            try {
              const res = await fetch('/style_grid/style/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  name: newName,
                  prompt: displayStyle.prompt,
                  negative_prompt: displayStyle.negative_prompt,
                  description: displayStyle.description,
                  category: displayStyle.category,
                  source: displayStyle.source_file,
                }),
              })
              const data = await res.json().catch(() => ({}))
              if (!res.ok || data.ok === false || data.error) {
                showToast(
                  typeof data.error === 'string' && data.error
                    ? data.error
                    : 'Duplicate failed',
                  'error',
                )
                return  // keep dialog open
              }
              // Refresh the catalog the same way SG_INIT/SG_STYLES_UPDATE do —
              // GET /style_grid/styles returns { categories, usage, presets },
              // not a flat array.
              const fresh = await fetch('/style_grid/styles').then((r) => r.json())
              const flat = Object.values(fresh.categories || {}).flat()
              useStylesStore.getState().setStyles(flat)
              showToast(`Duplicated as "${newName}"`, 'success')
              setDuplicateOpen(false)
            } catch {
              showToast('Duplicate failed', 'error')
              // keep dialog open on network failure too
            }
          }}
        />
      </Portal>

      <Portal>
        <ConfirmInputDialog
          open={moveOpen}
          title={`Move "${displayStyle.name}" to category`}
          initialValue={displayStyle.category}
          placeholder="Category name"
          confirmLabel="Move"
          suggestions={categories().filter((c) => c !== displayStyle.category)}
          onCancel={() => setMoveOpen(false)}
          onConfirm={async (newCategory) => {
            if (newCategory === displayStyle.category) {
              setMoveOpen(false)
              return
            }
            try {
              const res = await fetch('/style_grid/style/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  name: displayStyle.name,
                  prompt: displayStyle.prompt,
                  negative_prompt: displayStyle.negative_prompt,
                  description: displayStyle.description,
                  category: newCategory,
                  source: displayStyle.source_file,
                }),
              })
              const data = await res.json().catch(() => ({}))
              if (!res.ok || data.ok === false || data.error) {
                showToast(
                  typeof data.error === 'string' && data.error
                    ? data.error
                    : 'Move failed',
                  'error',
                )
                return
              }
              const fresh = await fetch('/style_grid/styles').then((r) => r.json())
              const flat = Object.values(fresh.categories || {}).flat()
              useStylesStore.getState().setStyles(flat)
              showToast(`Moved "${displayStyle.name}" to "${newCategory}"`, 'success')
              setMoveOpen(false)
            } catch {
              showToast('Move failed', 'error')
            }
          }}
        />
      </Portal>

      <Portal>
        <EditStyleDialog
          open={editOpen}
          style={displayStyle}
          categories={categories().filter((c) => c !== displayStyle.category)}
          onCancel={() => setEditOpen(false)}
          onSave={async (fields) => {
            try {
              const res = await fetch('/style_grid/style/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  name: displayStyle.name,
                  prompt: fields.prompt,
                  negative_prompt: fields.negative_prompt,
                  description: fields.description,
                  category: fields.category,
                  source: displayStyle.source_file,
                }),
              })
              const data = await res.json().catch(() => ({}))
              if (!res.ok || data.ok === false || data.error) {
                showToast(
                  typeof data.error === 'string' && data.error
                    ? data.error
                    : 'Save failed',
                  'error',
                )
                return  // keep dialog open so edits aren't lost
              }
              const fresh = await fetch('/style_grid/styles').then((r) => r.json())
              const flat = Object.values(fresh.categories || {}).flat()
              useStylesStore.getState().setStyles(flat)
              showToast(`Saved "${displayStyle.name}"`, 'success')
              setEditOpen(false)
            } catch {
              showToast('Save failed', 'error')
              // keep dialog open on network failure too
            }
          }}
        />
      </Portal>

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
                body: JSON.stringify({ name: displayStyle.name, image: reader.result }),
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
              // ThumbnailPreview listens on window 'message' via onHostMessage
              // (bridge.ts) — a same-window postMessage reaches it directly,
              // no host round-trip needed.
              window.postMessage(
                { type: 'SG_THUMB_DONE', styleId: displayStyle.name, version: Date.now() },
                '*',
              )
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
