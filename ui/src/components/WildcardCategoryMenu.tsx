import { Dices } from 'lucide-react'
import { sendToHost } from '../bridge'
import { useStylesStore } from '../store/stylesStore'
import { MenuItem, ViewportFixedMenu } from './ViewportFixedMenu'

type WildcardCategoryMenuProps = {
  category: string
  x: number
  y: number
  onClose: () => void
  restoreFocusTo?: HTMLElement | null
}

/** Shared right-click menu: insert `{sg:category}` wildcard into the host. */
export function WildcardCategoryMenu({
  category,
  x,
  y,
  onClose,
  restoreFocusTo,
}: WildcardCategoryMenuProps) {
  return (
    <ViewportFixedMenu x={x} y={y} onClose={onClose} restoreFocusTo={restoreFocusTo}>
      <MenuItem
        onSelect={() => {
          sendToHost({ type: 'SG_WILDCARD_CATEGORY', category })
          onClose()
        }}
      >
        <span className="inline-flex items-center gap-2">
          <Dices className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Add category as wildcard
        </span>
      </MenuItem>
      <MenuItem
        onSelect={() => {
          useStylesStore.getState().startSliceMode(category)
          onClose()
        }}
      >
        <span className="inline-flex items-center gap-2">
          <Dices className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Select styles for wildcard...
        </span>
      </MenuItem>
    </ViewportFixedMenu>
  )
}
