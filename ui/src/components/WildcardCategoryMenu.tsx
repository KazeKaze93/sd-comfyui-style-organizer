import { Dices } from 'lucide-react'
import { sendToHost } from '../bridge'
import { useStylesStore } from '../store/stylesStore'
import { ViewportFixedMenu } from './ViewportFixedMenu'

type WildcardCategoryMenuProps = {
  category: string
  x: number
  y: number
  onClose: () => void
}

/** Shared right-click menu: insert `{sg:category}` wildcard into the host. */
export function WildcardCategoryMenu({
  category,
  x,
  y,
  onClose,
}: WildcardCategoryMenuProps) {
  return (
    <ViewportFixedMenu x={x} y={y} onDismiss={onClose}>
      <button
        type="button"
        className="w-full text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors"
        onClick={() => {
          sendToHost({ type: 'SG_WILDCARD_CATEGORY', category })
          onClose()
        }}
      >
        <span className="inline-flex items-center gap-2">
          <Dices className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Add category as wildcard
        </span>
      </button>
      <button
        type="button"
        className="w-full text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors"
        onClick={() => {
          useStylesStore.getState().startSliceMode(category)
          onClose()
        }}
      >
        <span className="inline-flex items-center gap-2">
          <Dices className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Select styles for wildcard...
        </span>
      </button>
    </ViewportFixedMenu>
  )
}
