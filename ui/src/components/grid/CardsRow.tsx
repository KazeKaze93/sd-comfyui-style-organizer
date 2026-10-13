import { memo, type ReactNode } from 'react'
import type { Style } from '../../bridge'
import { useFocusedColForRow } from '../../lib/gridFocus'
import { styleRowKey } from '../../store/stylesStore'
import { StyleCard } from '../StyleCard'
import { GRID_FOCUS_RING_CLASS, gridGapClass } from './constants'

export type CardsRowProps = {
  styles: readonly Style[]
  columns: number
  compactMode: boolean
  windowed: boolean
  /** Virtualizer row index — used for `data-cell-row` / roving tabindex. */
  rowIndex: number
  renderCard?: (style: Style) => ReactNode
}

function cardsRowPropsEqual(prev: CardsRowProps, next: CardsRowProps): boolean {
  if (
    prev.columns !== next.columns ||
    prev.compactMode !== next.compactMode ||
    prev.windowed !== next.windowed ||
    prev.renderCard !== next.renderCard ||
    prev.rowIndex !== next.rowIndex ||
    prev.styles.length !== next.styles.length
  ) {
    return false
  }
  // Prefer reference equality; fall back to row-key identity for rebuilt slices.
  if (prev.styles === next.styles) return true
  for (let i = 0; i < prev.styles.length; i += 1) {
    if (prev.styles[i] !== next.styles[i]) return false
  }
  return true
}

/** Column gap only; vertical gap is padding-bottom on the virtual row. */
export const CardsRow = memo(function CardsRow({
  styles,
  columns,
  compactMode,
  windowed,
  rowIndex,
  renderCard,
}: CardsRowProps) {
  // Per-row focus subscription — sibling rows bail out on col/row moves (toggle P50).
  const focusedCol = useFocusedColForRow(rowIndex)
  return (
    <div
      role="presentation"
      className={`grid content-start ${gridGapClass(compactMode, windowed)}`}
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
      }}
    >
      {styles.map((style, col) => {
        const tab = focusedCol === col ? 0 : -1
        if (renderCard) {
          return (
            <div
              key={styleRowKey(style)}
              role="gridcell"
              data-cell-row={rowIndex}
              data-cell-col={col}
              tabIndex={tab}
              className={`rounded-lg ${GRID_FOCUS_RING_CLASS}`}
            >
              {renderCard(style)}
            </div>
          )
        }
        return (
          <StyleCard
            key={styleRowKey(style)}
            style={style}
            windowed={windowed}
            cellRow={rowIndex}
            cellCol={col}
            tabIndex={tab}
          />
        )
      })}
    </div>
  )
}, cardsRowPropsEqual)
