import { ChevronDown, ChevronRight } from 'lucide-react'
import { useCategoryColor, useCategorySelectedCount } from '../../store/stylesStore'

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
  onToggleCollapse: (category: string) => void
  onSelectAll: (category: string) => void
  onContextMenu?: (category: string, clientX: number, clientY: number) => void
}

export function CategoryHeaderRow({
  category,
  count,
  collapsed,
  isStickyActive,
  onToggleCollapse,
  onSelectAll,
  onContextMenu,
}: CategoryHeaderRowProps) {
  const selectedCount = useCategorySelectedCount(category)
  const allSelected = count > 0 && selectedCount === count

  return (
    <div
      data-sg-category-header={category}
      data-sg-sticky-header={isStickyActive ? 'true' : undefined}
      className="flex items-center gap-2 mb-2 sticky top-0
                 bg-sg-bg/95 backdrop-blur-sm py-1 z-10 cursor-pointer
                 hover:bg-sg-surface/30 rounded-md transition-colors -mx-1 px-1"
      title="Right-click for options"
      onClick={() => onToggleCollapse(category)}
      onContextMenu={
        onContextMenu
          ? (e) => {
              e.preventDefault()
              e.stopPropagation()
              onContextMenu(category, e.clientX, e.clientY)
            }
          : undefined
      }
    >
      <span className="text-sg-muted">
        {collapsed
          ? <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
      </span>
      <CategoryTitle cat={category} />
      <span className="text-xs text-sg-muted">
        ({count})
      </span>
      <div className="flex-1" />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onSelectAll(category)
        }}
        className="text-xs text-sg-muted hover:text-sg-accent-text
                   transition-colors px-2 py-0.5 rounded
                   hover:bg-sg-accent/10"
      >
        {allSelected ? 'Deselect All' : 'Select All'}
      </button>
    </div>
  )
}
