/** @vitest-environment jsdom */
import { act, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  closeTopLayer,
  hasOpenLayer,
  registerLayer,
  resetLayerStackForTests,
  useLayer,
} from './layerStack'

beforeEach(() => {
  resetLayerStackForTests()
})

afterEach(() => {
  resetLayerStackForTests()
})

describe('layerStack register / close / LIFO', () => {
  it('closes topmost layer first (LIFO)', () => {
    const closes: string[] = []
    registerLayer('a', () => {
      closes.push('a')
    })
    registerLayer('b', () => {
      closes.push('b')
    })
    registerLayer('c', () => {
      closes.push('c')
    })

    expect(hasOpenLayer()).toBe(true)
    expect(closeTopLayer()).toBe(true)
    expect(closes).toEqual(['c'])
    expect(closeTopLayer()).toBe(true)
    expect(closes).toEqual(['c', 'b'])
    expect(closeTopLayer()).toBe(true)
    expect(closes).toEqual(['c', 'b', 'a'])
    expect(closeTopLayer()).toBe(false)
    expect(hasOpenLayer()).toBe(false)
  })

  it('unregister removes a middle layer without closing it', () => {
    const closeA = vi.fn()
    const closeB = vi.fn()
    const closeC = vi.fn()
    registerLayer('a', closeA)
    const unregisterB = registerLayer('b', closeB)
    registerLayer('c', closeC)

    unregisterB()
    expect(closeB).not.toHaveBeenCalled()

    expect(closeTopLayer()).toBe(true)
    expect(closeC).toHaveBeenCalledOnce()
    expect(closeTopLayer()).toBe(true)
    expect(closeA).toHaveBeenCalledOnce()
    expect(closeB).not.toHaveBeenCalled()
  })

  it('unregister is idempotent', () => {
    const close = vi.fn()
    const unregister = registerLayer('x', close)
    unregister()
    unregister()
    expect(hasOpenLayer()).toBe(false)
    expect(closeTopLayer()).toBe(false)
    expect(close).not.toHaveBeenCalled()
  })
})

describe('useLayer', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    root = null
    host?.remove()
    host = null
    resetLayerStackForTests()
  })

  function mount(ui: ReactNode) {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => {
      root!.render(ui)
    })
  }

  it('registers while open and unregisters on unmount', () => {
    const close = vi.fn()

    function Probe({ open }: { open: boolean }) {
      useLayer(open, close)
      return null
    }

    mount(<Probe open />)
    expect(hasOpenLayer()).toBe(true)

    act(() => {
      root!.unmount()
    })
    root = null
    expect(hasOpenLayer()).toBe(false)
    expect(close).not.toHaveBeenCalled()
  })

  it('unregisters when open becomes false', () => {
    const close = vi.fn()

    function Probe() {
      const [open, setOpen] = useState(true)
      useLayer(open, close)
      return (
        <button type="button" onClick={() => setOpen(false)}>
          close
        </button>
      )
    }

    mount(<Probe />)
    expect(hasOpenLayer()).toBe(true)

    act(() => {
      host!.querySelector('button')!.click()
    })
    expect(hasOpenLayer()).toBe(false)
    expect(close).not.toHaveBeenCalled()
  })

  it('closeTopLayer invokes the hook close callback', () => {
    const close = vi.fn()

    function Probe() {
      useLayer(true, close)
      return null
    }

    mount(<Probe />)
    expect(closeTopLayer()).toBe(true)
    expect(close).toHaveBeenCalledOnce()
  })
})
