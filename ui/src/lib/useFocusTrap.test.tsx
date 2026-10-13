/** @vitest-environment jsdom */
import { act, useRef, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { useFocusTrap } from './useFocusTrap'

describe('useFocusTrap', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    root = null
    host?.remove()
    host = null
  })

  function mount(ui: ReactNode) {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => {
      root!.render(ui)
    })
  }

  function TrapProbe({
    active,
    restoreFocus = true,
    useInitial = false,
  }: {
    active: boolean
    restoreFocus?: boolean
    useInitial?: boolean
  }) {
    const containerRef = useRef<HTMLDivElement>(null)
    const initialFocusRef = useRef<HTMLElement | null>(null)
    useFocusTrap(containerRef, active, {
      initialFocus: useInitial ? initialFocusRef : undefined,
      restoreFocus,
    })
    return (
      <div ref={containerRef} data-testid="trap">
        <button type="button" data-testid="first">
          First
        </button>
        <button
          type="button"
          ref={(el) => {
            initialFocusRef.current = el
          }}
          data-testid="second"
        >
          Second
        </button>
        <button type="button" data-testid="third">
          Third
        </button>
      </div>
    )
  }

  it('focuses the first focusable on open', () => {
    const opener = document.createElement('button')
    opener.textContent = 'opener'
    document.body.appendChild(opener)
    opener.focus()

    mount(<TrapProbe active />)
    expect(document.activeElement?.getAttribute('data-testid')).toBe('first')
    opener.remove()
  })

  it('focuses initialFocus when provided', () => {
    mount(<TrapProbe active useInitial />)
    expect(document.activeElement?.getAttribute('data-testid')).toBe('second')
  })

  it('cycles Tab and Shift+Tab inside the trap', () => {
    mount(<TrapProbe active />)
    const trap = host!.querySelector('[data-testid="trap"]')!
    const first = host!.querySelector('[data-testid="first"]') as HTMLButtonElement
    const third = host!.querySelector('[data-testid="third"]') as HTMLButtonElement

    third.focus()
    act(() => {
      trap.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
      )
    })
    expect(document.activeElement).toBe(first)

    first.focus()
    act(() => {
      trap.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          bubbles: true,
          cancelable: true,
          shiftKey: true,
        }),
      )
    })
    expect(document.activeElement).toBe(third)
  })

  it('restores focus to the opener on close', () => {
    const opener = document.createElement('button')
    opener.textContent = 'opener'
    document.body.appendChild(opener)
    opener.focus()

    function App() {
      const [open, setOpen] = useState(true)
      return (
        <div>
          <button type="button" data-testid="toggle" onClick={() => setOpen(false)}>
            hide
          </button>
          {open ? <TrapProbe active /> : null}
        </div>
      )
    }

    mount(<App />)
    expect(document.activeElement?.getAttribute('data-testid')).toBe('first')

    act(() => {
      host!.querySelector('[data-testid="toggle"]')!.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
    })
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})
