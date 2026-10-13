import { memo, type ReactNode } from 'react'
import type { Style } from '../../bridge'
import { styleRowKey } from '../../store/stylesStore'
import { StyleCard } from '../StyleCard'
import { gridGapClass } from './constants'

export type CardsRowProps = {
  styles: readonly Style[]
  columns: number
  compactMode: boolean
  windowed: boolean
  renderCard?: (style: Style) => ReactNode
}

function cardsRowPropsEqual(prev: CardsRowProps, next: CardsRowProps): boolean {
  if (
    prev.columns !== next.columns ||
    prev.compactMode !== next.compactMode ||
    prev.windowed !== next.windowed ||
    prev.renderCard !== next.renderCard ||
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
  renderCard,
}: CardsRowProps) {
  return (
    <div
      className={`grid content-start ${gridGapClass(compactMode, windowed)}`}
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
      }}
    >
      {styles.map((style) =>
        renderCard ? (
          <div key={styleRowKey(style)}>{renderCard(style)}</div>
        ) : (
          <StyleCard key={styleRowKey(style)} style={style} windowed={windowed} />
        ),
      )}
    </div>
  )
}, cardsRowPropsEqual)
