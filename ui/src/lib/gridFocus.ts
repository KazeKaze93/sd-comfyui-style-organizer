import { useSyncExternalStore } from 'react'
import type { GridCell } from './gridNav'

type Listener = () => void

let focusedCell: GridCell | null = null
const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getFocusedCell(): GridCell | null {
  return focusedCell
}

export function setFocusedCell(cell: GridCell | null): void {
  if (
    focusedCell === cell ||
    (focusedCell !== null &&
      cell !== null &&
      focusedCell.row === cell.row &&
      focusedCell.col === cell.col)
  ) {
    return
  }
  focusedCell = cell
  emit()
}

/** Module-level focus store for K-GRID (read/write without React). */
export const gridFocusStore = {
  get focusedCell(): GridCell | null {
    return focusedCell
  },
  setFocusedCell,
}

/** Narrow selector — re-renders only when `focusedCell` identity/value changes. */
export function useFocusedCell(): GridCell | null {
  return useSyncExternalStore(subscribe, getFocusedCell, getFocusedCell)
}

/**
 * Row index only — VirtualStyleGrid rangeExtractor pins the focused row.
 * Col-only moves (toggle clicks across a row) skip the virtualizer re-render.
 */
export function useFocusedRow(): number | null {
  return useSyncExternalStore(
    subscribe,
    () => focusedCell?.row ?? null,
    () => null,
  )
}

/**
 * Focused column for one virtual row, or null when focus is elsewhere.
 * CardsRow/CategoryHeaderRow subscribe per row so sibling rows bail out.
 */
export function useFocusedColForRow(rowIndex: number): number | null {
  return useSyncExternalStore(
    subscribe,
    () => (focusedCell?.row === rowIndex ? focusedCell.col : null),
    () => null,
  )
}

/** Test helper — clear focus between cases. */
export function __resetGridFocusForTests(): void {
  focusedCell = null
  emit()
}
