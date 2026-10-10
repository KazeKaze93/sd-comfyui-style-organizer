import type { ReactNode } from 'react'
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

export function CardsRow({
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
}
