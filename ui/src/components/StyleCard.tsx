import { memo, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
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
    selectedStyles, toggleStyle, isFavorite, toggleFavorite, usageCounts, styles, activeSource, showToast, categories,
    presets, clearAll,
  } = useStylesStore()
  const [menuPos, setMenuPos] = useState<{ x: number, y: number } | null>(null)
  const [pickerPos, setPickerPos] = useState<{ x: number, y: number } | null>(null)
  const [duplicateOpen, setDuplicateOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isSelected = !presetName && selectedStyles.some(s => s.name === style.name)
  const fav = isFavorite(style.name)
  const usageCount = usageCounts[style.name] || 0
  const duplicates = styles.filter(s => s.name === style.name)
  const hasMultipleSources = duplicates.length > 1
  const sourceLabels = duplicates.map((dup) =>
    ((dup.source_file || 'Unknown').split(/[\\/]/).pop() || 'Unknown')
      .replace(/\.csv$/i, '')
  )
  const maxSourceLabelLen = sourceLabels.reduce((max, label) => Math.max(max, label.length), 0)
  const pickerWidthCh = Math.min(48, Math.max(18, maxSourceLabelLen + 4))

  const displayName = style.name.includes('_')
    ? style.name.split('_').slice(1).join(' ')
    : style.name

  const borderColor = getCategoryColor(style.category || 'OTHER')

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
      <ThumbnailPreview style={style} presetName={presetName}>
        <motion.div
          data-sg-card="true"
          title={presetName ? undefined : style.name}
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
              const preset = presets[presetName]
              if (!preset) return
              clearAll()
              preset.styles.forEach((n) => {
                const s = styles.find((st) => st.name === n)
                if (s) toggleStyle(s)
              })
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

          {/* Selected indicator */}
          {!presetName && isSelected && (
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
            <button
              type="button"
              onClick={async (e) => {
                e.stopPropagation()
                if (!window.confirm(`Delete preset "${presetName}"?`)) return
                try {
                  const res = await fetch('/style_grid/presets/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: presetName }),
                  })
                  const data = await res.json().catch(() => ({}))
                  if (!res.ok || data.ok === false || data.error) {
                    showToast(
                      typeof data.error === 'string' && data.error
                        ? data.error
                        : 'Delete preset failed',
                      'error',
                    )
                    return
                  }
                  if (data.presets) {
                    useStylesStore.setState({ presets: data.presets })
                  }
                  showToast(`Deleted preset "${presetName}"`, 'success')
                } catch {
                  showToast('Delete preset failed', 'error')
                }
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
              onClick={() => { navigator.clipboard.writeText(style.prompt); setMenuPos(null) }}
            >
              📋 Copy prompt
            </button>
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors"
              onClick={() => { setMenuPos(null); setEditOpen(true) }}
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
              onClick={() => { setMenuPos(null); setMoveOpen(true) }}
            >
              📂 Move to category...
            </button>
            <div className="h-px my-1 bg-sg-border" />
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors"
              onClick={() => { sendToHost({ type: 'SG_GENERATE_PREVIEW', styleId: style.name }); setMenuPos(null) }}
            >
              🎨 Generate preview (SD)
            </button>
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
                if (!window.confirm(`Delete "${style.name}"? This cannot be undone.`)) return
                try {
                  const res = await fetch('/style_grid/style/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: style.name, source: style.source_file }),
                  })
                  const data = await res.json().catch(() => ({}))
                  if (!res.ok || data.ok === false) {
                    showToast(
                      typeof data.error === 'string' && data.error
                        ? data.error
                        : `Failed to delete ${style.name}`,
                      'error',
                    )
                    return
                  }
                  if (selectedStyles.some((s) => s.name === style.name)) {
                    toggleStyle(style)
                  }
                  useStylesStore.setState((state) => ({
                    styles: state.styles.filter((s) => s.name !== style.name),
                  }))
                  showToast(`Deleted "${style.name}"`, 'success')
                } catch {
                  showToast(`Failed to delete ${style.name}`, 'error')
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

      <ConfirmInputDialog
        open={duplicateOpen}
        title={`Duplicate "${style.name}"`}
        initialValue={`${style.name} copy`}
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
                prompt: style.prompt,
                negative_prompt: style.negative_prompt,
                description: style.description,
                category: style.category,
                source: style.source_file,
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
            useStylesStore.getState().setStyles(flat, useStylesStore.getState().tab)
            showToast(`Duplicated as "${newName}"`, 'success')
            setDuplicateOpen(false)
          } catch {
            showToast('Duplicate failed', 'error')
            // keep dialog open on network failure too
          }
        }}
      />

      <ConfirmInputDialog
        open={moveOpen}
        title={`Move "${style.name}" to category`}
        initialValue={style.category}
        placeholder="Category name"
        confirmLabel="Move"
        suggestions={categories().filter((c) => c !== style.category)}
        onCancel={() => setMoveOpen(false)}
        onConfirm={async (newCategory) => {
          if (newCategory === style.category) {
            setMoveOpen(false)
            return
          }
          try {
            const res = await fetch('/style_grid/style/save', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: style.name,
                prompt: style.prompt,
                negative_prompt: style.negative_prompt,
                description: style.description,
                category: newCategory,
                source: style.source_file,
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
            useStylesStore.getState().setStyles(flat, useStylesStore.getState().tab)
            showToast(`Moved "${style.name}" to "${newCategory}"`, 'success')
            setMoveOpen(false)
          } catch {
            showToast('Move failed', 'error')
          }
        }}
      />

      <EditStyleDialog
        open={editOpen}
        style={style}
        categories={categories().filter((c) => c !== style.category)}
        onCancel={() => setEditOpen(false)}
        onSave={async (fields) => {
          try {
            const res = await fetch('/style_grid/style/save', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: style.name,
                prompt: fields.prompt,
                negative_prompt: fields.negative_prompt,
                description: fields.description,
                category: fields.category,
                source: style.source_file,
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
            useStylesStore.getState().setStyles(flat, useStylesStore.getState().tab)
            showToast(`Saved "${style.name}"`, 'success')
            setEditOpen(false)
          } catch {
            showToast('Save failed', 'error')
            // keep dialog open on network failure too
          }
        }}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''  // allow re-selecting the same file later
          if (!file) return
          if (file.size > 2 * 1024 * 1024) {
            showToast('Image must be under 2MB', 'error')
            return
          }
          const reader = new FileReader()
          reader.onload = async () => {
            try {
              const res = await fetch('/style_grid/thumbnail/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: style.name, image: reader.result }),
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
                { type: 'SG_THUMB_DONE', styleId: style.name, version: Date.now() },
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
