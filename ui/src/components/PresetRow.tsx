import { useEffect, useId, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  resolvePresetMembers,
  styleDisplayName,
  useStylesStore,
  type PresetRecord,
  type ResolvedPresetMember,
} from '../store/stylesStore'
import { useLayer } from '../lib/layerStack'
import { useFocusTrap } from '../lib/useFocusTrap'
import { cn } from '../lib/utils'

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent focus-visible:ring-offset-1 focus-visible:ring-offset-sg-bg'

type Props = {
  name: string
  preset: PresetRecord
}

export function PresetRow({ name, preset }: Props) {
  const styles = useStylesStore((s) => s.styles)
  const selectedStyles = useStylesStore((s) => s.selectedStyles)
  const activeWildcards = useStylesStore((s) => s.activeWildcards)
  const loadPreset = useStylesStore((s) => s.loadPreset)
  const unapplyPreset = useStylesStore((s) => s.unapplyPreset)
  const deletePreset = useStylesStore((s) => s.deletePreset)
  const renamePreset = useStylesStore((s) => s.renamePreset)
  const showToast = useStylesStore((s) => s.showToast)

  const [expanded, setExpanded] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [renameValue, setRenameValue] = useState(name)
  const [renameExists, setRenameExists] = useState(false)
  const [busy, setBusy] = useState(false)
  const renamePanelRef = useRef<HTMLDivElement>(null)
  const renameRef = useRef<HTMLInputElement>(null)
  const deletePanelRef = useRef<HTMLDivElement>(null)
  const deleteCancelRef = useRef<HTMLButtonElement>(null)
  const renameTitleId = useId()
  const renameInputId = useId()
  const deleteTitleId = useId()

  const members = resolvePresetMembers(preset.styles ?? [], styles)
  const foundMembers = members.filter((m): m is Extract<ResolvedPresetMember, { status: 'found' }> =>
    m.status === 'found')
  const found = foundMembers.length
  const total = members.length
  const missing = total - found
  const wcCount = (preset.wildcards ?? []).length
  const wcKey = (c: string, s: string) =>
    `${String(c || '').toLowerCase()}\0${String(s || '').toLowerCase()}`
  const presetWcKeys = new Set(
    (preset.wildcards ?? []).map((wc) => wcKey(String(wc.category || ''), String(wc.spec || '')))
  )
  const activeWcKeys = new Set(activeWildcards.map((w) => wcKey(w.category, w.spec)))
  const isActive = foundMembers.length > 0 &&
    foundMembers.every((m) => selectedStyles.some((s) => s.name === m.style.name)) &&
    [...presetWcKeys].every((k) => activeWcKeys.has(k))

  useLayer(renameOpen, () => {
    if (!busy) setRenameOpen(false)
  })
  useLayer(deleteOpen, () => {
    if (!busy) setDeleteOpen(false)
  })
  useFocusTrap(renamePanelRef, renameOpen, { initialFocus: renameRef })
  useFocusTrap(deletePanelRef, deleteOpen, { initialFocus: deleteCancelRef })

  useEffect(() => {
    if (!renameOpen) return
    setRenameValue(name)
    setRenameExists(false)
  }, [renameOpen, name])

  const metaParts = [
    total === 0
      ? '0 styles'
      : missing > 0
        ? `${found}/${total} styles`
        : `${total} styles`,
  ]
  if (wcCount > 0) metaParts.push(`${wcCount} wildcards`)
  if (preset.note?.trim()) metaParts.push(preset.note.trim())

  const doRename = async (overwrite: boolean) => {
    const next = renameValue.trim()
    if (!next || busy) return
    if (next === name) {
      setRenameOpen(false)
      return
    }
    setBusy(true)
    try {
      const result = await renamePreset(name, next, { overwrite })
      if (!result.ok) {
        if (result.error === 'exists') {
          setRenameExists(true)
          return
        }
        showToast(
          typeof result.error === 'string' && result.error
            ? result.error
            : 'Rename failed',
          'error',
        )
        return
      }
      showToast(`Renamed to "${next}"`, 'success')
      setRenameOpen(false)
    } finally {
      setBusy(false)
    }
  }

  const doDelete = async () => {
    if (busy) return
    setBusy(true)
    try {
      const result = await deletePreset(name)
      if (!result.ok) {
        showToast(
          typeof result.error === 'string' && result.error
            ? result.error
            : 'Delete failed',
          'error',
        )
        return
      }
      showToast(`Deleted "${name}"`, 'success')
      setDeleteOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={`rounded-lg border transition-colors ${
        isActive
          ? 'border-sg-accent/60 bg-sg-accent/5'
          : 'border-sg-border bg-sg-surface/60 hover:border-sg-accent/40'
      }`}
    >
      <div className="flex items-start gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={cn(
            'mt-0.5 w-5 h-5 shrink-0 flex items-center justify-center text-sg-muted hover:text-sg-text transition-colors rounded',
            FOCUS_RING,
          )}
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse set' : 'Expand set'}
          title={expanded ? 'Collapse' : 'Expand'}
        >
          <span className={`text-xs transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
        </button>

        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-sg-text truncate" title={name}>
            {name}
          </div>
          <div className="text-[11px] text-sg-muted mt-0.5 truncate" title={metaParts.join(' · ')}>
            {metaParts.join(' · ')}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => isActive ? unapplyPreset(name) : loadPreset(name)}
            className={cn(
              'px-2 py-1 text-xs rounded border border-sg-border text-sg-text hover:bg-sg-accent/20 transition-colors',
              FOCUS_RING,
            )}
            title={isActive ? 'Remove this set from the current selection' : 'Apply this set to the current selection'}
          >
            {isActive ? 'Unapply' : 'Apply'}
          </button>
          <button
            type="button"
            onClick={() => setRenameOpen(true)}
            className={cn(
              'px-2 py-1 text-xs rounded border border-sg-border text-sg-text hover:bg-sg-accent/20 transition-colors',
              FOCUS_RING,
            )}
            title="Rename this set"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            className={cn(
              'px-2 py-1 text-xs rounded border border-sg-danger/40 text-sg-danger-text hover:bg-sg-danger/20 transition-colors',
              FOCUS_RING,
            )}
            title="Delete this set"
          >
            Delete
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <ul className="border-t border-sg-border px-3 py-2 space-y-1">
              {members.length === 0 && (
                <li className="text-xs text-sg-muted">No styles in this set</li>
              )}
              {members.map((m, i) => {
                if (m.status === 'found') {
                  return (
                    <li key={`f:${m.style.source_file}:${m.style.name}:${i}`} className="text-xs text-sg-text truncate">
                      {styleDisplayName(m.style.name)}
                      {m.style.source_file ? (
                        <span className="text-sg-muted"> · {m.style.source_file.replace(/\\/g, '/').split('/').pop()?.replace(/\.csv$/i, '')}</span>
                      ) : null}
                    </li>
                  )
                }
                return (
                  <li
                    key={`m:${m.name}:${i}`}
                    className="text-xs text-sg-warning-text/90 truncate"
                    title={m.pack ? `Missing from ${m.pack}` : 'Missing from library'}
                  >
                    Missing: {styleDisplayName(m.name)}
                    {m.pack ? ` (${m.pack})` : ''}
                  </li>
                )
              })}
              {(preset.wildcards ?? []).map((wc, i) => (
                <li key={`w:${wc.category}:${wc.spec}:${i}`} className="text-xs text-sg-wildcard-text/80 truncate">
                  🎲 {wc.category}{wc.spec ? `:${wc.spec}` : ''}
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>

      {renameOpen && (
        <div className="fixed inset-0 z-[9999]">
          <div className="absolute inset-0 bg-black/50" onClick={() => { if (!busy) setRenameOpen(false) }} />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div
              ref={renamePanelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={renameTitleId}
              className="pointer-events-auto bg-sg-surface border border-sg-border rounded-lg shadow-xl p-4 w-80"
              onClick={(e) => e.stopPropagation()}
            >
              <label id={renameTitleId} htmlFor={renameInputId} className="block text-sm font-medium text-sg-text mb-2">
                Rename set
              </label>
              <input
                id={renameInputId}
                ref={renameRef}
                type="text"
                value={renameValue}
                disabled={busy}
                onChange={(e) => {
                  setRenameValue(e.target.value)
                  setRenameExists(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void doRename(renameExists)
                  }
                }}
                className={cn(
                  'w-full h-9 px-3 rounded border border-sg-border bg-sg-surface text-sg-text text-sm focus:border-sg-accent focus:outline-none disabled:opacity-45',
                  FOCUS_RING,
                )}
              />
              {renameExists && (
                <div className="mt-2 text-xs text-sg-warning-text/90">
                  A set named &ldquo;{renameValue.trim()}&rdquo; already exists.
                </div>
              )}
              <div className="flex justify-end gap-2 mt-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setRenameOpen(false)}
                  className={cn(
                    'px-3 py-1.5 text-sm text-sg-text border border-sg-border rounded hover:bg-sg-accent/20',
                    FOCUS_RING,
                  )}
                >
                  Cancel
                </button>
                {renameExists ? (
                  <button
                    type="button"
                    disabled={busy || !renameValue.trim()}
                    onClick={() => void doRename(true)}
                    className={cn(
                      'px-3 py-1.5 text-sm rounded bg-sg-warning-text/90 text-sg-text',
                      FOCUS_RING,
                    )}
                  >
                    Overwrite
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy || !renameValue.trim()}
                    onClick={() => void doRename(false)}
                    className={cn(
                      'px-3 py-1.5 text-sm rounded bg-sg-accent text-white',
                      FOCUS_RING,
                    )}
                  >
                    Rename
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteOpen && (
        <div className="fixed inset-0 z-[9999]">
          <div className="absolute inset-0 bg-black/50" onClick={() => { if (!busy) setDeleteOpen(false) }} />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div
              ref={deletePanelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={deleteTitleId}
              className="pointer-events-auto bg-sg-surface border border-sg-border rounded-lg shadow-xl p-4 w-80"
              onClick={(e) => e.stopPropagation()}
            >
              <div id={deleteTitleId} className="text-sm font-medium text-sg-text mb-2">Delete set?</div>
              <p className="text-xs text-sg-muted leading-relaxed">
                Delete &ldquo;{name}&rdquo; permanently? This cannot be undone.
              </p>
              <div className="flex justify-end gap-2 mt-3">
                <button
                  ref={deleteCancelRef}
                  type="button"
                  disabled={busy}
                  onClick={() => setDeleteOpen(false)}
                  className={cn(
                    'px-3 py-1.5 text-sm text-sg-text border border-sg-border rounded hover:bg-sg-accent/20',
                    FOCUS_RING,
                  )}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void doDelete()}
                  className={cn(
                    'px-3 py-1.5 text-sm rounded bg-sg-danger/90 text-white hover:bg-sg-danger',
                    FOCUS_RING,
                  )}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
