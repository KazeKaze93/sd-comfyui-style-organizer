import { useState, type KeyboardEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { WILDCARD_KIND_DECK } from '../bridge'
import { useStylesStore } from '../store/stylesStore'
import { CHIP_FOCUS_RING } from '../lib/chipStyles'
import { describeSpec } from '../lib/wildcardSlice'
import { SHUFFLE_CHIP_TITLE } from '../lib/wildcardLabels'
import { wildcardKey } from '../lib/wildcardKey'
import { DeckIcon } from './DeckIcon'
import { DeckStrip } from './DeckStrip'
import { SaveSetDialog } from './SaveSetDialog'

const chipBase =
  'flex items-center gap-1 px-2 py-1 rounded-full text-xs select-none transition-colors'

export function SelectedBar() {
  const {
    selectedStyles, toggleStyle,
    activeWildcards, removeWildcard,
    styles, activeSource,
  } = useStylesStore(
    useShallow((s) => ({
      selectedStyles: s.selectedStyles,
      toggleStyle: s.toggleStyle,
      activeWildcards: s.activeWildcards,
      removeWildcard: s.removeWildcard,
      styles: s.styles,
      activeSource: s.activeSource,
    })),
  )
  const [saveOpen, setSaveOpen] = useState(false)

  if (selectedStyles.length === 0 && activeWildcards.length === 0) return null

  const displayName = (name: string) =>
    name.includes('_') ? name.split('_').slice(1).join(' ') : name

  /** Same scoping as StyleGrid's allNamesInCategory (category + activeSource).
   * Category match is case-insensitive: chip categories come from lowercased tokens. */
  const allNamesInCategory = (category: string) => {
    const want = category.toLowerCase()
    return styles
      .filter((s) => {
        if ((s.category || 'OTHER').toLowerCase() !== want) return false
        if (activeSource && s.source_file !== activeSource) return false
        return true
      })
      .map((s) => s.name)
  }

  const onChipKeyDown = (
    e: KeyboardEvent,
    remove: () => void,
  ) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return
    e.preventDefault()
    e.stopPropagation()
    remove()
  }

  return (
    <>
      <div className="flex items-start gap-2 px-4 py-2">
        <div className="min-w-0 flex-1">
          {selectedStyles.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selectedStyles.map(s => (
                <span
                  key={s.name}
                  tabIndex={0}
                  role="group"
                  aria-label={displayName(s.name)}
                  onKeyDown={(e) => onChipKeyDown(e, () => toggleStyle(s))}
                  className={`${chipBase} ${CHIP_FOCUS_RING}
                             bg-sg-accent/20 border border-sg-accent/40
                             text-sg-text hover:bg-sg-accent/30`}
                >
                  {displayName(s.name)}
                  <button
                    type="button"
                    aria-label={`Remove ${s.name}`}
                    onClick={() => toggleStyle(s)}
                    className={`text-sg-muted hover:text-sg-text ml-1
                               transition-colors leading-none rounded-sm
                               ${CHIP_FOCUS_RING}`}
                  >✕</button>
                </span>
              ))}
            </div>
          )}
        </div>
        {selectedStyles.length > 0 && (
          <button
            type="button"
            onClick={() => setSaveOpen(true)}
            className={`shrink-0 px-2.5 py-1 text-xs rounded border border-sg-accent/50
                       bg-sg-accent/15 text-sg-text hover:bg-sg-accent/25 transition-colors
                       ${CHIP_FOCUS_RING}`}
            title="Save current selection as a set"
          >
            Save set ({selectedStyles.length})
          </button>
        )}
      </div>

      {activeWildcards.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 py-2">
          {activeWildcards.map((ref) => {
            const { category, spec } = ref
            const isDeck = ref.kind === WILDCARD_KIND_DECK
            const { count, names } = describeSpec(category, spec, allNamesInCategory(category))
            const isEmptyFallback = spec !== '' && count === 0

            const label = spec === ''
              ? category
              : isEmptyFallback
                ? `${category} (falls back to all)`
                : `${category} (${count})`

            const sliceTitle = spec === ''
              ? undefined
              : isEmptyFallback
                ? `No styles in this pack match the slice — resolves to a random style from all of ${category} instead.`
                : names.join(', ')
            const title = isDeck
              ? (sliceTitle ? `${SHUFFLE_CHIP_TITLE}. ${sliceTitle}` : SHUFFLE_CHIP_TITLE)
              : sliceTitle
            return (
              <span
                key={wildcardKey(category, spec, ref.kind)}
                tabIndex={0}
                role="group"
                aria-label={label}
                title={title}
                onKeyDown={(e) => onChipKeyDown(e, () => removeWildcard(ref))}
                className={`${chipBase} ${CHIP_FOCUS_RING}
                           ${isEmptyFallback
                             ? 'bg-sg-warning/20 border border-sg-warning/50 text-sg-warning-text'
                             : 'bg-sg-wildcard/20 border border-sg-wildcard/40 text-sg-text'}
                           hover:bg-sg-wildcard/30`}
              >
                <span className="mr-0.5">
                  {isDeck
                    ? <DeckIcon className="h-3 w-3 inline-block align-text-bottom shrink-0" />
                    : '🎲'}
                </span>
                {isDeck && <span className="sr-only">{SHUFFLE_CHIP_TITLE}</span>}
                {label}
                <button
                  type="button"
                  aria-label={`Remove ${label}`}
                  onClick={() => removeWildcard(ref)}
                  className={`text-sg-muted hover:text-sg-text ml-1 transition-colors leading-none rounded-sm
                             ${CHIP_FOCUS_RING}`}
                >✕</button>
              </span>
            )
          })}
          <DeckStrip />
        </div>
      )}

      <SaveSetDialog open={saveOpen} onClose={() => setSaveOpen(false)} />
    </>
  )
}
