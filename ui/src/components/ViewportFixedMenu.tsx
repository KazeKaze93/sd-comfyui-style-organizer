import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { fitFixedMenuPosition, MENU_MARGIN } from '../lib/fitFixedMenuPosition'
import { useLayer } from '../lib/layerStack'
import { cn } from '../lib/utils'

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent focus-visible:ring-offset-1 focus-visible:ring-offset-sg-bg'

type RestoreTarget =
  | HTMLElement
  | null
  | RefObject<HTMLElement | null>
  | undefined

type Props = {
  /** When false, render nothing. Defaults to true (parent may unmount instead). */
  open?: boolean
  x: number
  y: number
  onClose?: () => void
  /** Legacy alias used by callers mid-migration; prefer `onClose`. */
  onDismiss?: () => void
  restoreFocusTo?: RestoreTarget
  children: ReactNode
  className?: string
  style?: CSSProperties
  backdropClassName?: string
}

const DEFAULT_MENU_CLASS =
  'fixed z-[9999] bg-sg-popover border border-sg-border rounded-lg shadow-xl py-1 min-w-52 w-max max-w-sm'

const DEFAULT_BACKDROP_CLASS = 'fixed inset-0 z-[9998]'

const MAX_HEIGHT = `calc(100vh - ${2 * MENU_MARGIN}px)`

function resolveRestoreTarget(target: RestoreTarget): HTMLElement | null {
  if (!target) return null
  if (typeof target === 'object' && 'current' in target) {
    return target.current
  }
  return target
}

function listMenuItems(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter(
    (el) =>
      el.getAttribute('aria-disabled') !== 'true' &&
      !(el instanceof HTMLButtonElement && el.disabled),
  )
}

/**
 * Fixed context menu portaled to document.body (escapes sidebar overflow),
 * then flipped/clamped to stay inside the iframe viewport using measured size.
 * Registers on the Escape layer stack; roving focus via MenuItem children.
 */
export function ViewportFixedMenu({
  open = true,
  x,
  y,
  onClose,
  onDismiss,
  restoreFocusTo,
  children,
  className = DEFAULT_MENU_CLASS,
  style,
  backdropClassName = DEFAULT_BACKDROP_CLASS,
}: Props) {
  const close = onClose ?? onDismiss
  if (!close) {
    throw new Error('ViewportFixedMenu requires onClose (or legacy onDismiss)')
  }

  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const restoreRef = useRef<HTMLElement | null>(null)
  const closedRef = useRef(false)

  const dismiss = useCallback(() => {
    if (closedRef.current) return
    closedRef.current = true
    close()
    const target = restoreRef.current ?? resolveRestoreTarget(restoreFocusTo)
    if (target && typeof target.focus === 'function') {
      requestAnimationFrame(() => {
        target.focus()
      })
    }
  }, [close, restoreFocusTo])

  useLayer(open, dismiss)

  useEffect(() => {
    if (!open) {
      closedRef.current = false
      return
    }
    closedRef.current = false
    const prev = document.activeElement
    restoreRef.current =
      resolveRestoreTarget(restoreFocusTo) ??
      (prev instanceof HTMLElement ? prev : null)
  }, [open, restoreFocusTo])

  useLayoutEffect(() => {
    if (!open) return
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPos(
      fitFixedMenuPosition(
        x,
        y,
        rect.width,
        rect.height,
        window.innerWidth,
        window.innerHeight,
        MENU_MARGIN,
      ),
    )
  }, [open, x, y, children])

  // Focus first enabled item only when the menu opens (not on children re-renders).
  useLayoutEffect(() => {
    if (!open) return
    const el = ref.current
    if (!el) return
    listMenuItems(el)[0]?.focus()
  }, [open])

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const root = ref.current
    if (!root) return
    const items = listMenuItems(root)
    if (items.length === 0) return

    const current = document.activeElement
    const index = items.findIndex((el) => el === current)

    if (event.key === 'Tab') {
      event.preventDefault()
      dismiss()
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      const next = index < 0 ? 0 : (index + 1) % items.length
      items[next]?.focus()
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      const next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length
      items[next]?.focus()
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      items[0]?.focus()
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      items[items.length - 1]?.focus()
    }
  }

  if (!open) return null

  return createPortal(
    <>
      <div
        className={backdropClassName}
        onClick={dismiss}
        onContextMenu={(e) => {
          e.preventDefault()
          dismiss()
        }}
      />
      <div
        ref={ref}
        role="menu"
        tabIndex={-1}
        className={className}
        style={{
          ...style,
          left: pos.x,
          top: pos.y,
          maxHeight: MAX_HEIGHT,
          overflowY: 'auto',
        }}
        onContextMenu={(e) => e.preventDefault()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onMenuKeyDown}
      >
        {children}
      </div>
    </>,
    document.body,
  )
}

type MenuItemProps = {
  onSelect?: () => void
  disabled?: boolean
  children: ReactNode
  className?: string
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'disabled' | 'children' | 'className'>

const DEFAULT_ITEM_CLASS =
  'w-full text-left px-3 py-1.5 text-sm text-sg-text hover:bg-sg-accent/20 transition-colors disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:bg-transparent'

export function MenuItem({
  onSelect,
  disabled = false,
  children,
  className,
  ...rest
}: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={disabled ? -1 : 0}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      className={cn(DEFAULT_ITEM_CLASS, FOCUS_RING, className)}
      onClick={() => {
        if (disabled) return
        onSelect?.()
      }}
      onKeyDown={(event) => {
        if (disabled) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect?.()
        }
      }}
      {...rest}
    >
      {children}
    </button>
  )
}

export { FOCUS_RING as MENU_FOCUS_RING }
