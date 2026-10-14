import { useShallow } from 'zustand/react/shallow'
import { sendToHost } from '../bridge'
import { hasDeckWildcard } from '../lib/deckState'
import { CHIP_FOCUS_RING } from '../lib/chipStyles'
import {
  DECK_NEW,
  DECK_NEW_ARIA,
  DECK_NEXT_LABEL,
  DECK_RESTART,
  DECK_RESTART_ARIA,
  DECK_SEED_LABEL,
  DECK_STRIP_ARIA,
  DECK_STRIP_TITLE,
} from '../lib/wildcardLabels'
import { useStylesStore } from '../store/stylesStore'
import { DeckIcon } from './DeckIcon'

const STRIP_CLASS =
  'flex items-center gap-2 px-2 py-1 rounded-full text-xs border border-sg-wildcard/40 bg-sg-wildcard/10 text-sg-text'
const ACTION_CLASS =
  'px-1.5 py-0.5 rounded text-sg-muted hover:text-sg-text hover:bg-sg-surface/60 transition-colors'
const DRAW_NUMBER_OFFSET = 1 // deck_index counts finished draws; the user sees the next one (1-based)

/** Position of the shuffle deck plus Restart / New deck. Hidden unless a shuffle chip is active. */
export function DeckStrip() {
  const { activeWildcards, deckState } = useStylesStore(
    useShallow((s) => ({ activeWildcards: s.activeWildcards, deckState: s.deckState })),
  )
  if (!deckState || !hasDeckWildcard(activeWildcards)) return null

  return (
    <div role="group" aria-label={DECK_STRIP_ARIA} title={DECK_STRIP_TITLE} className={STRIP_CLASS}>
      <DeckIcon className="h-3 w-3 inline-block align-text-bottom shrink-0" />
      <span>
        {DECK_SEED_LABEL} {deckState.seed}, {DECK_NEXT_LABEL} #{deckState.index + DRAW_NUMBER_OFFSET}
      </span>
      <button
        type="button"
        aria-label={DECK_RESTART_ARIA}
        onClick={() => sendToHost({ type: 'SG_DECK_RESTART' })}
        className={`${ACTION_CLASS} ${CHIP_FOCUS_RING}`}
      >
        {DECK_RESTART}
      </button>
      <button
        type="button"
        aria-label={DECK_NEW_ARIA}
        onClick={() => sendToHost({ type: 'SG_DECK_NEW' })}
        className={`${ACTION_CLASS} ${CHIP_FOCUS_RING}`}
      >
        {DECK_NEW}
      </button>
    </div>
  )
}
