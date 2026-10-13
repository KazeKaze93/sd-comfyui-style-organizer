import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export type UseFocusTrapOptions = {
  initialFocus?: RefObject<HTMLElement | null>
  /** When true (default), restore focus to the previously focused element on close. */
  restoreFocus?: boolean
}

function listFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true',
  )
}

/**
 * Trap Tab / Shift+Tab inside `ref` while `active`.
 * Focuses `initialFocus` (or the first focusable) on open; restores opener on close.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  options?: UseFocusTrapOptions,
): void {
  const restoreFocus = options?.restoreFocus !== false
  const initialFocus = options?.initialFocus
  const restoreRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!active) return
    const root = ref.current
    if (!root) return

    const prev = document.activeElement
    restoreRef.current = prev instanceof HTMLElement ? prev : null

    const focusInitial = () => {
      const initial = initialFocus?.current
      if (initial && root.contains(initial)) {
        initial.focus()
        return
      }
      const focusable = listFocusable(root)
      if (focusable.length > 0) {
        focusable[0].focus()
        return
      }
      if (!root.hasAttribute('tabindex')) {
        root.setAttribute('tabindex', '-1')
      }
      root.focus()
    }

    focusInitial()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const focusable = listFocusable(root)
      if (focusable.length === 0) {
        event.preventDefault()
        root.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const current = document.activeElement
      if (event.shiftKey) {
        if (current === first || !root.contains(current)) {
          event.preventDefault()
          last.focus()
        }
        return
      }
      if (current === last || !root.contains(current)) {
        event.preventDefault()
        first.focus()
      }
    }

    root.addEventListener('keydown', onKeyDown)
    return () => {
      root.removeEventListener('keydown', onKeyDown)
      if (restoreFocus) {
        const target = restoreRef.current
        if (target && typeof target.focus === 'function') {
          target.focus()
        }
      }
      restoreRef.current = null
    }
  }, [active, ref, restoreFocus, initialFocus])
}
