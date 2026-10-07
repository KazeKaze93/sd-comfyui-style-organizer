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
        className="w-full text-left px-3 py-1.5 text-sm text-white hover:bg-sg-accent/20 transition-colors"
        onClick={() => {
          sendToHost({ type: 'SG_WILDCARD_CATEGORY', category })
          onClose()
        }}
      >
        🎲 Add category as wildcard
      </button>
      <button
        type="button"
        className="w-full text-left px-3 py-1.5 text-sm text-white hover:bg-sg-accent/20 transition-colors"
        onClick={() => {
          useStylesStore.getState().startSliceMode(category)
          onClose()
        }}
      >
        🎲 Select styles for wildcard...
      </button>
    </ViewportFixedMenu>
  )
}
