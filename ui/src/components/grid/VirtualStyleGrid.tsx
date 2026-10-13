import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
} from '@tanstack/react-virtual'
import type { Style } from '../../bridge'
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
  onHeaderContextMenu?: (category: string, clientX: number, clientY: number) => void
  renderCard?: (style: Style) => ReactNode
  children?: ReactNode
}

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

/**
 * Profile (phase-B init N=5000): measureElement ~29 ms self — fixed estimates only.
 * Memo: avoid remount fan-out when parent chrome re-renders.
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

  const stickyIndexes = useMemo(() => headerRowIndexes(rows), [rows])

  // Catalog size for bench/profile readiness (virtualized DOM ≠ N cards).
  const itemCount = useMemo(
    () => groups.reduce((n, [, styles]) => n + styles.length, 0),
    [groups],
  )

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
      if (stickyIndexes.length === 0) {
        return defaultRangeExtractor(range)
      }
      activeStickyIndexRef.current = activeStickyHeaderIndex(
        stickyIndexes,
        range.startIndex,
      )
      const next = new Set([
        activeStickyIndexRef.current,
        ...defaultRangeExtractor(range),
      ])
      return [...next].sort((a, b) => a - b)
    },
    [stickyIndexes],
  )

  const estimateSize = useCallback(
    (index: number) => estimateRowSize(rows[index], compactMode, windowed),
    [rows, compactMode, windowed],
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

  useEffect(() => {
    virtualizer.measure()
  }, [columns, compactMode, windowed, virtualizer])

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

  return (
    <div
      ref={rootRef}
      className="relative w-full"
      role="grid"
      aria-rowcount={rows.length}
      data-sg-item-count={itemCount}
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualRow) => {
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
