/** @vitest-environment jsdom */
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  closeTopLayer,
  hasOpenLayer,
  resetLayerStackForTests,
} from '../lib/layerStack'
import { MenuItem, ViewportFixedMenu } from './ViewportFixedMenu'

let root: Root | null = null
let host: HTMLDivElement | null = null

beforeEach(() => {
  resetLayerStackForTests()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  root = null
  host?.remove()
  host = null
  resetLayerStackForTests()
  document.body.innerHTML = ''
})

function Harness({
  onClose,
  restoreFocusTo,
}: {
  onClose: () => void
  restoreFocusTo?: HTMLElement | null
}) {
  const [open, setOpen] = useState(true)
  return (
    <ViewportFixedMenu
      open={open}
      x={10}
      y={10}
      onClose={() => {
        setOpen(false)
        onClose()
      }}
      restoreFocusTo={restoreFocusTo}
    >
      <MenuItem onSelect={() => {}}>Alpha</MenuItem>
      <MenuItem disabled onSelect={() => {}}>
        Disabled
      </MenuItem>
      <MenuItem onSelect={() => {}}>Beta</MenuItem>
    </ViewportFixedMenu>
  )
}

describe('ViewportFixedMenu', () => {
  it('registers on the layer stack and closes via closeTopLayer', () => {
    const onClose = vi.fn()
    act(() => {
      root!.render(<Harness onClose={onClose} />)
    })
    expect(hasOpenLayer()).toBe(true)
    expect(document.querySelector('[role="menu"]')).toBeTruthy()

    act(() => {
      expect(closeTopLayer()).toBe(true)
    })
    expect(onClose).toHaveBeenCalledOnce()
    expect(hasOpenLayer()).toBe(false)
  })

  it('focuses the first enabled menuitem on open', () => {
    act(() => {
      root!.render(<Harness onClose={() => {}} />)
    })
    const items = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).filter((el) => !el.hasAttribute('disabled'))
    expect(items[0]?.textContent).toContain('Alpha')
    expect(document.activeElement).toBe(items[0])
  })

  it('moves focus with ArrowDown and wraps', () => {
    act(() => {
      root!.render(<Harness onClose={() => {}} />)
    })
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!
    const items = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'),
    )
    expect(document.activeElement).toBe(items[0])

    act(() => {
      menu.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      )
    })
    expect(document.activeElement).toBe(items[1])

    act(() => {
      menu.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      )
    })
    expect(document.activeElement).toBe(items[0])
  })

  it('Tab dismisses the menu', () => {
    const onClose = vi.fn()
    act(() => {
      root!.render(<Harness onClose={onClose} />)
    })
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!
    act(() => {
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('restores focus to restoreFocusTo on dismiss', async () => {
    const opener = document.createElement('button')
    opener.textContent = 'opener'
    document.body.appendChild(opener)
    opener.focus()
    expect(document.activeElement).toBe(opener)

    const onClose = vi.fn()
    act(() => {
      root!.render(<Harness onClose={onClose} restoreFocusTo={opener} />)
    })
    expect(document.activeElement).not.toBe(opener)

    act(() => {
      closeTopLayer()
    })
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)))
    })
    expect(document.activeElement).toBe(opener)
  })
})
