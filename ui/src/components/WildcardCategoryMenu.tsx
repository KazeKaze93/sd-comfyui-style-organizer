import { Dices } from 'lucide-react'
import { sendToHost, WILDCARD_KIND_DECK } from '../bridge'
import {
  MENU_GROUP_RANDOM,
  MENU_GROUP_SHUFFLE,
  MENU_PICK_STYLES,
  MENU_WHOLE_CATEGORY,
} from '../lib/wildcardLabels'
import { useStylesStore } from '../store/stylesStore'
import { DeckIcon } from './DeckIcon'
import { MenuDivider } from './MenuDivider'
import { MenuItem, ViewportFixedMenu } from './ViewportFixedMenu'

const MENU_HEADING = 'text-xs text-sg-muted px-3 pt-1.5'
const ITEM_ROW = 'inline-flex items-center gap-2'
const ITEM_ICON = 'h-3.5 w-3.5 shrink-0'

type WildcardCategoryMenuProps = {
  category: string
  x: number
  y: number
  onClose: () => void
  restoreFocusTo?: HTMLElement | null
}

/** Shared right-click menu: insert `{sg:category}` (random) or `{sgd:category}` (shuffle) wildcards into the host. */
export function WildcardCategoryMenu({ category, x, y, onClose, restoreFocusTo }: WildcardCategoryMenuProps) {
  return (
    <ViewportFixedMenu x={x} y={y} onClose={onClose} restoreFocusTo={restoreFocusTo}>
      <div role="group" aria-label={MENU_GROUP_RANDOM}>
        <div className={MENU_HEADING} aria-hidden>{MENU_GROUP_RANDOM}</div>
        <MenuItem
          onSelect={() => {
            sendToHost({ type: 'SG_WILDCARD_CATEGORY', category })
            onClose()
          }}
        >
          <span className={ITEM_ROW}>
            <Dices className={ITEM_ICON} aria-hidden />
            {MENU_WHOLE_CATEGORY}
          </span>
        </MenuItem>
        <MenuItem
          onSelect={() => {
            useStylesStore.getState().startSliceMode(category)
            onClose()
          }}
        >
          <span className={ITEM_ROW}>
            <Dices className={ITEM_ICON} aria-hidden />
            {MENU_PICK_STYLES}
          </span>
        </MenuItem>
      </div>
      <MenuDivider />
      <div role="group" aria-label={MENU_GROUP_SHUFFLE}>
        <div className={MENU_HEADING} aria-hidden>{MENU_GROUP_SHUFFLE}</div>
        <MenuItem
          onSelect={() => {
            sendToHost({ type: 'SG_WILDCARD_CATEGORY', category, kind: WILDCARD_KIND_DECK })
            onClose()
          }}
        >
          <span className={ITEM_ROW}>
            <DeckIcon className={ITEM_ICON} />
            {MENU_WHOLE_CATEGORY}
          </span>
        </MenuItem>
        <MenuItem
          onSelect={() => {
            useStylesStore.getState().startSliceMode(category, WILDCARD_KIND_DECK)
            onClose()
          }}
        >
          <span className={ITEM_ROW}>
            <DeckIcon className={ITEM_ICON} />
            {MENU_PICK_STYLES}
          </span>
        </MenuItem>
      </div>
    </ViewportFixedMenu>
  )
}
