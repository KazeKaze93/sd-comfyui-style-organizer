/**
 * Bench copy of ui/src/components/grid/constants.ts layout numbers.
 * Keep in sync — layout invariants fail closed when these drift from the app.
 */

export const GRID_GAP_NORMAL_PX = 8
export const GRID_GAP_COMPACT_PX = 4

export const CARD_HEIGHT_WINDOWED_PX = 34
export const CARD_HEIGHT_NORMAL_PX = 46

export const CARD_ROW_HEIGHT_NORMAL_PX = CARD_HEIGHT_NORMAL_PX + GRID_GAP_NORMAL_PX
export const CARD_ROW_HEIGHT_COMPACT_PX = CARD_HEIGHT_NORMAL_PX + GRID_GAP_COMPACT_PX
export const CARD_ROW_HEIGHT_WINDOWED_PX = CARD_HEIGHT_WINDOWED_PX + GRID_GAP_COMPACT_PX

/** Densities exercised by layout bench (matches gapScreenshots.mjs). */
export const LAYOUT_DENSITIES = Object.freeze([
  'windowed',
  'compact-windowed',
  'normal',
  'compact',
])

/**
 * @param {'windowed' | 'compact-windowed' | 'normal' | 'compact'} density
 * @returns {{ compactMode: boolean, windowed: boolean, rowGapPx: number, cardRowHeightPx: number, maxCardHeightPx: number }}
 */
export function metricsForDensity(density) {
  const compactMode = density === 'compact' || density === 'compact-windowed'
  const windowed = density === 'windowed' || density === 'compact-windowed'
  const rowGapPx = compactMode || windowed ? GRID_GAP_COMPACT_PX : GRID_GAP_NORMAL_PX
  let cardRowHeightPx = CARD_ROW_HEIGHT_NORMAL_PX
  if (windowed) cardRowHeightPx = CARD_ROW_HEIGHT_WINDOWED_PX
  else if (compactMode) cardRowHeightPx = CARD_ROW_HEIGHT_COMPACT_PX
  const maxCardHeightPx = cardRowHeightPx - rowGapPx
  return { compactMode, windowed, rowGapPx, cardRowHeightPx, maxCardHeightPx }
}
