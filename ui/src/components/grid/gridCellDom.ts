import type { GridCell } from '../../lib/gridNav'

/** DOM markers for roving grid cells (no per-card key listeners). */
export const CELL_ROW_ATTR = 'data-cell-row'
export const CELL_COL_ATTR = 'data-cell-col'

export function cellSelector(row: number, col: number): string {
  return `[${CELL_ROW_ATTR}="${row}"][${CELL_COL_ATTR}="${col}"]`
}

export function findCellElement(
  root: ParentNode,
  row: number,
  col: number,
): HTMLElement | null {
  return root.querySelector<HTMLElement>(cellSelector(row, col))
}

/** Read cell coordinates from a focused / event target (or ancestor). */
export function readCellPos(target: EventTarget | null): GridCell | null {
  if (!(target instanceof Element)) return null
  const el = target.closest<HTMLElement>(`[${CELL_ROW_ATTR}][${CELL_COL_ATTR}]`)
  if (!el) return null
  const row = Number(el.getAttribute(CELL_ROW_ATTR))
  const col = Number(el.getAttribute(CELL_COL_ATTR))
  if (!Number.isFinite(row) || !Number.isFinite(col)) return null
  return { row, col }
}

/**
 * Focus a mounted cell. Returns false when the cell is not in the DOM yet
 * (caller should scroll / wait for virtualizer paint).
 */
export function focusCell(
  root: ParentNode,
  pos: GridCell,
  options?: FocusOptions,
): boolean {
  const el = findCellElement(root, pos.row, pos.col)
  if (!el) return false
  el.focus(options ?? { preventScroll: true })
  return true
}

/** Open the card/header context menu via the existing `onContextMenu` path. */
export function dispatchCellContextMenu(el: HTMLElement): void {
  const rect = el.getBoundingClientRect()
  el.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(rect.left + rect.width / 2),
      clientY: Math.round(rect.top + rect.height / 2),
      view: window,
    }),
  )
}

/** Roving tabindex for a cell given the module focus store value. */
export function cellTabIndex(
  focused: GridCell | null,
  row: number,
  col: number,
): number {
  if (focused === null) return row === 0 && col === 0 ? 0 : -1
  return focused.row === row && focused.col === col ? 0 : -1
}
