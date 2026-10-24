import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from 'react'
import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
} from '@tanstack/react-virtual'
import type { Style } from '../../bridge'
import {
  getFocusedCell,
  setFocusedCell,
  useFocusedCell,
  useFocusedRow,
} from '../../lib/gridFocus'
import {
  cellCount,
  nextCell,
  type GridCell,
  type GridNavKey,
} from '../../lib/gridNav'
import {
  activeStickyHeaderIndex,
  buildGridRows,
  findHeaderRowIndex,
  headerRowIndexes,
  type CategoryGroup,
  type GridRow,
} from './buildGridRows'
import { CardsRow } from './CardsRow'
import { CategoryHeaderRow } from './CategoryHeaderRow'
import {
  cardRowHeightPx,
  columnsForWidth,
  GRID_VIRTUAL_OVERSCAN,
  HEADER_ROW_HEIGHT,
  VIRTUALIZER_TEST_INITIAL_RECT,
  gridGapPx,
  minCardWidthPx,
  rowGapPx,
} from './constants'
import { dispatchCellContextMenu, findCellElement } from './gridCellDom'
import {
  getCachedRangeIndexes,
  type StickyRangeCache,
} from './rangeCache'

export type VirtualStyleGridProps = {
  groups: readonly CategoryGroup[]
  collapsedCategories: ReadonlySet<string>
  compactMode: boolean
  windowed: boolean
  includeHeaders?: boolean
  /** Bumps when search/category/source change so the list resets to top. */
  scrollResetKey?: string
  onToggleCollapse: (category: string) => void
  onSelectAll: (category: string) => void
  onHeaderContextMenu?: (
    category: string,
    clientX: number,
    clientY: number,
    restoreFocusTo: HTMLElement,
  ) => void
  renderCard?: (style: Style) => ReactNode
  children?: ReactNode
}

const NAV_KEYS = new Set<string>([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
])

function estimateRowSize(
  row: GridRow | undefined,
  compactMode: boolean,
  windowed: boolean,
): number {
  const gap = rowGapPx(compactMode, windowed)
  if (!row || row.kind === 'cards') {
    return cardRowHeightPx(compactMode, windowed)
  }
  return HEADER_ROW_HEIGHT + gap
}

function firstFocusableCell(rows: readonly GridRow[]): GridCell | null {
  for (let row = 0; row < rows.length; row++) {
    if (cellCount(rows[row]) > 0) return { row, col: 0 }
  }
  return null
}

function clampFocusedCell(
  rows: readonly GridRow[],
  cell: GridCell,
): GridCell | null {
  if (rows.length === 0) return null
  if (cell.row < 0 || cell.row >= rows.length) return firstFocusableCell(rows)
  const count = cellCount(rows[cell.row])
  if (count <= 0) return firstFocusableCell(rows)
  return { row: cell.row, col: Math.max(0, Math.min(cell.col, count - 1)) }
}

/**
 * Isolates useFocusedCell so col-only moves do not re-render the virtualizer.
 * Restores DOM focus after keyboard moves / virtual row remounts.
 */
function GridFocusRestorer({
  rootRef,
  pendingFocusRef,
  virtualItemsKey,
}: {
  rootRef: RefObject<HTMLDivElement | null>
  pendingFocusRef: MutableRefObject<GridCell | null>
  virtualItemsKey: string
}) {
  const focusedCell = useFocusedCell()
  useLayoutEffect(() => {
    if (!focusedCell) return
    const root = rootRef.current
    if (!root) return
    const pending = pendingFocusRef.current
    const active = document.activeElement
    const focusWasInGrid = root.contains(active)
    const keyboardMove =
      pending != null &&
      pending.row === focusedCell.row &&
      pending.col === focusedCell.col
    if (!focusWasInGrid && !keyboardMove) return
    const el = findCellElement(root, focusedCell.row, focusedCell.col)
    if (el && active !== el) {
      el.focus({ preventScroll: true })
    }
    if (keyboardMove) pendingFocusRef.current = null
  }, [focusedCell, virtualItemsKey, rootRef, pendingFocusRef])
  return null
}

/**
 * Profile (phase-B init N=5000): measureElement ~29 ms self — fixed estimates only.
 * Keyboard: one container onKeyDown; focused row pinned in rangeExtractor (WebUI parity).
 */
export const VirtualStyleGrid = memo(function VirtualStyleGrid({
  groups,
  collapsedCategories,
  compactMode,
  windowed,
  includeHeaders = true,
  scrollResetKey,
  onToggleCollapse,
  onSelectAll,
  onHeaderContextMenu,
  renderCard,
  children,
}: VirtualStyleGridProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollElRef = useRef<HTMLElement | null>(null)
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null)
  const [widthPx, setWidthPx] = useState<number>(VIRTUALIZER_TEST_INITIAL_RECT.width)
  const activeStickyIndexRef = useRef(0)
  const rowsRef = useRef<GridRow[]>([])
  const pendingFocusRef = useRef<GridCell | null>(null)
  const rangeCacheRef = useRef<StickyRangeCache | null>(null)

  // Row only — col-only focus (toggle clicks across a row) skips this re-render.
  const focusedRow = useFocusedRow()

  const minW = minCardWidthPx(compactMode, windowed)
  const gapPx = gridGapPx(compactMode, windowed)
  const columns = useMemo(
    () => columnsForWidth(widthPx, minW, gapPx),
    [widthPx, minW, gapPx],
  )

  const rows = useMemo(
    () => buildGridRows(groups, collapsedCategories, columns, { includeHeaders }),
    [groups, collapsedCategories, columns, includeHeaders],
  )
  rowsRef.current = rows

  const stickyIndexes = useMemo(() => headerRowIndexes(rows), [rows])

  const itemCount = useMemo(
    () => groups.reduce((n, [, styles]) => n + styles.length, 0),
    [groups],
  )

  const pageRows = useMemo(() => {
    const viewportH = scrollEl?.clientHeight ?? VIRTUALIZER_TEST_INITIAL_RECT.height
    const rowH = cardRowHeightPx(compactMode, windowed)
    return Math.max(1, Math.floor(viewportH / rowH))
  }, [scrollEl, compactMode, windowed])

  // Default / clamp roving cell when the row model changes (tab stop only — no focus steal).
  useEffect(() => {
    if (rows.length === 0) {
      setFocusedCell(null)
      return
    }
    const current = getFocusedCell()
    if (!current) {
      setFocusedCell(firstFocusableCell(rows))
      return
    }
    const clamped = clampFocusedCell(rows, current)
    if (!clamped) {
      setFocusedCell(null)
      return
    }
    if (clamped.row !== current.row || clamped.col !== current.col) {
      setFocusedCell(clamped)
    }
  }, [rows])

  useEffect(() => {
    return () => {
      setFocusedCell(null)
    }
  }, [])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const parent = root.parentElement
    scrollElRef.current = parent
    setScrollEl(parent)

    const applyWidth = (w: number) => {
      if (w > 0) setWidthPx(w)
    }
    applyWidth(root.clientWidth)

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      applyWidth(entry.contentRect.width)
    })
    ro.observe(root)
    return () => ro.disconnect()
  }, [])

  const rangeExtractor = useCallback(
    (range: Range) => {
      const focused =
        focusedRow != null &&
        focusedRow >= 0 &&
        focusedRow < rowsRef.current.length
          ? focusedRow
          : null
      if (stickyIndexes.length === 0) {
        const base = defaultRangeExtractor(range)
        if (focused == null) return base
        const hit = getCachedRangeIndexes(rangeCacheRef.current, range, -1, focused)
        if (hit) return hit
        const next = new Set(base)
        next.add(focused)
        const result = [...next].sort((a, b) => a - b)
        rangeCacheRef.current = {
          startIndex: range.startIndex,
          endIndex: range.endIndex,
          sticky: -1,
          focusedRow: focused,
          count: range.count,
          result,
        }
        return result
      }
      const sticky = activeStickyHeaderIndex(stickyIndexes, range.startIndex)
      activeStickyIndexRef.current = sticky
      const hit = getCachedRangeIndexes(rangeCacheRef.current, range, sticky, focused)
      if (hit) return hit
      const next = new Set([sticky, ...defaultRangeExtractor(range)])
      if (focused != null) next.add(focused)
      const result = [...next].sort((a, b) => a - b)
      rangeCacheRef.current = {
        startIndex: range.startIndex,
        endIndex: range.endIndex,
        sticky,
        focusedRow: focused,
        count: range.count,
        result,
      }
      return result
    },
    [stickyIndexes, focusedRow],
  )

  const estimateSize = useCallback(
    (index: number) => estimateRowSize(rowsRef.current[index], compactMode, windowed),
    [compactMode, windowed],
  )

  // TanStack Virtual returns unstable function identities; React Compiler skips this file.
  // eslint-disable-next-line react-hooks/incompatible-library -- required virtualizer API
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollElRef.current ?? scrollEl,
    estimateSize,
    overscan: GRID_VIRTUAL_OVERSCAN,
    rangeExtractor,
    initialRect: VIRTUALIZER_TEST_INITIAL_RECT,
    // Fixed row heights — measureElement ResizeObserver thrash caused multi-second scroll TBT.
  })

  // Density/columns only — focusedRow is pinned via rangeExtractor (no full remasure).
  useEffect(() => {
    rangeCacheRef.current = null
    virtualizer.measure()
  }, [columns, compactMode, windowed, rows.length, virtualizer])

  useEffect(() => {
    if (scrollResetKey === undefined) return
    virtualizer.scrollToOffset(0)
  }, [scrollResetKey, virtualizer])

  const scrollToHeader = useCallback(
    (category: string) => {
      const headerIndex = findHeaderRowIndex(rows, category)
      if (headerIndex >= 0) {
        virtualizer.scrollToIndex(headerIndex, { align: 'start' })
      }
    },
    [rows, virtualizer],
  )

  const handleToggleCollapse = useCallback(
    (category: string) => {
      onToggleCollapse(category)
      requestAnimationFrame(() => scrollToHeader(category))
    },
    [onToggleCollapse, scrollToHeader],
  )

  const virtualItems = virtualizer.getVirtualItems()
  // Stable key for remount focus restore without depending on item object identity.
  const virtualItemsKey = virtualItems.map((v) => v?.index ?? '').join(',')

  const onGridKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (NAV_KEYS.has(e.key)) {
        const from = getFocusedCell() ?? firstFocusableCell(rowsRef.current)
        if (!from) return
        const next = nextCell(
          rowsRef.current,
          columns,
          from,
          e.key as GridNavKey,
          pageRows,
          e.ctrlKey || e.metaKey,
        )
        if (!next) {
          e.preventDefault()
          return
        }
        e.preventDefault()
        pendingFocusRef.current = next
        setFocusedCell(next)
        virtualizer.scrollToIndex(next.row, { align: 'auto' })
        return
      }

      if (e.key === 'Enter' || e.key === ' ') {
        const cell = getFocusedCell()
        if (!cell) return
        const root = rootRef.current
        const el = root ? findCellElement(root, cell.row, cell.col) : null
        // Focused <button> already activates on Enter/Space — do not double-fire.
        if (el && document.activeElement === el) return
        e.preventDefault()
        el?.click()
        return
      }

      if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
        const cell = getFocusedCell()
        if (!cell) return
        const root = rootRef.current
        const el = root ? findCellElement(root, cell.row, cell.col) : null
        if (!el) return
        e.preventDefault()
        dispatchCellContextMenu(el)
      }
    },
    [columns, pageRows, virtualizer],
  )

  return (
    <div
      ref={rootRef}
      className="relative w-full"
      role="grid"
      aria-label="Styles"
      aria-rowcount={rows.length}
      data-sg-item-count={itemCount}
      onKeyDown={onGridKeyDown}
    >
      <GridFocusRestorer
        rootRef={rootRef}
        pendingFocusRef={pendingFocusRef}
        virtualItemsKey={virtualItemsKey}
      />
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualRow) => {
          if (!virtualRow) return null
          const row = rows[virtualRow.index]
          if (!row) return null
          const isActiveSticky =
            row.kind === 'header' &&
            stickyIndexes.length > 0 &&
            virtualRow.index === activeStickyIndexRef.current

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              data-sg-row-kind={row.kind}
              role="row"
              aria-rowindex={virtualRow.index + 1}
              style={
                isActiveSticky
                  ? {
                      position: 'sticky',
                      top: 0,
                      zIndex: 10,
                      left: 0,
                      width: '100%',
                      height: `${virtualRow.size}px`,
                      paddingBottom: `${gapPx}px`,
                      boxSizing: 'border-box',
                    }
                  : {
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: `${virtualRow.size}px`,
                      paddingBottom: `${gapPx}px`,
                      boxSizing: 'border-box',
                      transform: `translateY(${virtualRow.start}px)`,
                    }
              }
            >
              {row.kind === 'header' ? (
                <CategoryHeaderRow
                  category={row.category}
                  count={row.count}
                  collapsed={row.collapsed}
                  isStickyActive={isActiveSticky}
                  rowIndex={virtualRow.index}
                  onToggleCollapse={handleToggleCollapse}
                  onSelectAll={onSelectAll}
                  onContextMenu={onHeaderContextMenu}
                />
              ) : (
                <CardsRow
                  styles={row.styles}
                  columns={columns}
                  compactMode={compactMode}
                  windowed={windowed}
                  rowIndex={virtualRow.index}
                  renderCard={renderCard}
                />
              )}
            </div>
          )
        })}
      </div>
      {children}
    </div>
  )
})
