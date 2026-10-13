import { memo } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { setFocusedCell, useFocusedColForRow } from '../../lib/gridFocus'
import { useCategoryColor, useCategorySelectedCount } from '../../store/stylesStore'
import { GRID_FOCUS_RING_CLASS } from './constants'

function CategoryTitle({ cat }: { cat: string }) {
  const color = useCategoryColor(cat)
  return (
    <span
      className="text-xs font-bold tracking-wider uppercase"
      style={{ color }}
    >
      {cat}
    </span>
  )
}

export type CategoryHeaderRowProps = {
  category: string
  count: number
  collapsed: boolean
  isStickyActive: boolean
  rowIndex: number
  onToggleCollapse: (category: string) => void
  onSelectAll: (category: string) => void
  onContextMenu?: (
    category: string,
    clientX: number,
    clientY: number,
    restoreFocusTo: HTMLElement,
  ) => void
}

/**
 * Sticky positioning lives on the virtual row wrapper (VirtualStyleGrid).
 * Collapse + Select All are real buttons; gridcell wrappers + data-cell attrs (WebUI parity).
 */
export const CategoryHeaderRow = memo(function CategoryHeaderRow({
  category,
  count,
  collapsed,
  isStickyActive,
  rowIndex,
  onToggleCollapse,
  onSelectAll,
  onContextMenu,
}: CategoryHeaderRowProps) {
  const focusedCol = useFocusedColForRow(rowIndex)
  const selectedCount = useCategorySelectedCount(category)
  const allSelected = count > 0 && selectedCount === count

  return (
    <div
      role="presentation"
      data-sg-category-header={category}
      data-sg-sticky-header={isStickyActive ? 'true' : undefined}
      className={`flex items-center gap-2 py-1 -mx-1 px-1
                 ${isStickyActive ? 'bg-sg-bg z-10' : 'bg-sg-bg/95'}`}
      title="Right-click for options"
      onContextMenu={
        onContextMenu
          ? (e) => {
              e.preventDefault()
              e.stopPropagation()
              const focusEl =
                (e.target instanceof Element
                  ? e.target.closest<HTMLElement>('[data-cell-row]')
                  : null) ?? e.currentTarget
              onContextMenu(category, e.clientX, e.clientY, focusEl)
            }
          : undefined
      }
    >
      <div role="gridcell" className="min-w-0 flex-1">
        <button
          type="button"
          data-cell-row={rowIndex}
          data-cell-col={0}
          tabIndex={focusedCol === 0 ? 0 : -1}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${category}`}
          onFocus={() => setFocusedCell({ row: rowIndex, col: 0 })}
          onClick={() => onToggleCollapse(category)}
          className={`flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left
                      transition-colors hover:bg-sg-surface/30 ${GRID_FOCUS_RING_CLASS}`}
        >
          <span className="text-sg-muted" aria-hidden>
            {collapsed
              ? <ChevronRight className="h-3.5 w-3.5" />
              : <ChevronDown className="h-3.5 w-3.5" />}
          </span>
          <CategoryTitle cat={category} />
          <span className="text-xs text-sg-muted">
            ({count})
          </span>
        </button>
      </div>
      <div role="gridcell" className="shrink-0">
        <button
          type="button"
          data-cell-row={rowIndex}
          data-cell-col={1}
          tabIndex={focusedCol === 1 ? 0 : -1}
          aria-label={`${allSelected ? 'Deselect' : 'Select'} all in ${category}`}
          onFocus={() => setFocusedCell({ row: rowIndex, col: 1 })}
          onClick={() => onSelectAll(category)}
          className={`text-xs text-sg-muted hover:text-sg-accent-text
                      transition-colors px-2 py-0.5 rounded
                      hover:bg-sg-accent/10 ${GRID_FOCUS_RING_CLASS}`}
        >
          {allSelected ? 'Deselect All' : 'Select All'}
        </button>
      </div>
    </div>
  )
})
