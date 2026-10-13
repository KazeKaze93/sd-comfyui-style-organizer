/** Min card widths matching today's CSS `minmax(W, 1fr)` grid tracks. */
export const MIN_CARD_WIDTH_NORMAL_PX = 150
export const MIN_CARD_WIDTH_WINDOWED_PX = 110
export const MIN_CARD_WIDTH_COMPACT_PX = 110
export const MIN_CARD_WIDTH_COMPACT_WINDOWED_PX = 80

/** Tailwind `gap-2` / `gap-1` in px (default root font size). Column gap = row gap. */
export const GRID_GAP_NORMAL_PX = 8
export const GRID_GAP_COMPACT_PX = 4

/** Named rect so jsdom virtualizer tests have a stable layout box. */
export const VIRTUALIZER_TEST_INITIAL_RECT = { width: 800, height: 600 } as const

/**
 * Card chrome heights (border + padding + one truncated line), excluding row gap.
 * Windowed uses `p-2`/`text-xs` (measured 34px @ 1280 bench); normal/compact
 * use `p-3`/`text-sm` (measured ~46–48px).
 */
export const CARD_HEIGHT_WINDOWED_PX = 34
export const CARD_HEIGHT_NORMAL_PX = 46

/**
 * Virtualizer card-row sizes = card height + ROW_GAP (padding-bottom).
 * ROW_GAP matches column gap: normal fullscreen `gap-2`, compact/windowed `gap-1`.
 */
export const CARD_ROW_HEIGHT_NORMAL_PX =
  CARD_HEIGHT_NORMAL_PX + GRID_GAP_NORMAL_PX
export const CARD_ROW_HEIGHT_COMPACT_PX =
  CARD_HEIGHT_NORMAL_PX + GRID_GAP_COMPACT_PX
export const CARD_ROW_HEIGHT_WINDOWED_PX =
  CARD_HEIGHT_WINDOWED_PX + GRID_GAP_COMPACT_PX

/**
 * Header content (py-1 + label/chevron; measured ~28px). estimateSize adds
 * ROW_GAP via padding-bottom so vertical rhythm matches phase-A CSS gap.
 */
export const HEADER_ROW_HEIGHT = 28

/** Profile (scroll N=5000): StyleCard/ThumbnailPreview remounts dominate — keep overscan tight. */
export const GRID_VIRTUAL_OVERSCAN = 2

/** Token focus ring — keyboard-only (`:focus-visible`), matches slice overlay buttons. */
export const GRID_FOCUS_RING_CLASS =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent'

/** @deprecated Prefer CARD_ROW_HEIGHT_* / HEADER_ROW_HEIGHT. */
export const GRID_HEADER_ROW_ESTIMATE_PX = HEADER_ROW_HEIGHT + GRID_GAP_NORMAL_PX
/** @deprecated Prefer CARD_ROW_HEIGHT_COMPACT_PX. */
export const GRID_CARD_ROW_ESTIMATE_COMPACT_PX = CARD_ROW_HEIGHT_COMPACT_PX
/** @deprecated Prefer CARD_ROW_HEIGHT_NORMAL_PX. */
export const GRID_CARD_ROW_ESTIMATE_NORMAL_PX = CARD_ROW_HEIGHT_NORMAL_PX

export function minCardWidthPx(compactMode: boolean, windowed: boolean): number {
  if (compactMode && windowed) return MIN_CARD_WIDTH_COMPACT_WINDOWED_PX
  if (compactMode) return MIN_CARD_WIDTH_COMPACT_PX
  if (windowed) return MIN_CARD_WIDTH_WINDOWED_PX
  return MIN_CARD_WIDTH_NORMAL_PX
}

/**
 * Gap matches StyleGrid CSS: `gap-2` only for normal+fullscreen;
 * compact or windowed use `gap-1`.
 */
export function gridGapPx(compactMode: boolean, windowed: boolean): number {
  return compactMode || windowed ? GRID_GAP_COMPACT_PX : GRID_GAP_NORMAL_PX
}

/** Alias — row gap equals column gap for phase-A parity. */
export function rowGapPx(compactMode: boolean, windowed: boolean): number {
  return gridGapPx(compactMode, windowed)
}

/** CSS gap utility matching {@link gridGapPx}. */
export function gridGapClass(compactMode: boolean, windowed: boolean): string {
  return compactMode || windowed ? 'gap-1' : 'gap-2'
}

/** Fixed card-row estimateSize for the active density. */
export function cardRowHeightPx(compactMode: boolean, windowed: boolean): number {
  if (windowed) return CARD_ROW_HEIGHT_WINDOWED_PX
  if (compactMode) return CARD_ROW_HEIGHT_COMPACT_PX
  return CARD_ROW_HEIGHT_NORMAL_PX
}

/**
 * Column count matching CSS `repeat(auto-fill, minmax(minW, 1fr))` with the same gap.
 * `widthPx` is the content box width of the grid container.
 */
export function columnsForWidth(
  widthPx: number,
  minCardWidth: number,
  gapPx: number,
): number {
  if (!Number.isFinite(widthPx) || widthPx <= 0) return 1
  return Math.max(1, Math.floor((widthPx + gapPx) / (minCardWidth + gapPx)))
}

/** Legacy `auto-fill` class for non-virtualized paths (slice mode). */
export function autoFillGridClass(compactMode: boolean, windowed: boolean): string {
  const minW = minCardWidthPx(compactMode, windowed)
  const gap = gridGapClass(compactMode, windowed)
  return `grid content-start grid-cols-[repeat(auto-fill,minmax(${minW}px,1fr))] ${gap}`
}
