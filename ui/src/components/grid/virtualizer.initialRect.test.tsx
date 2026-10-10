/** @vitest-environment jsdom */
import { act, useEffect, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { useVirtualizer } from '@tanstack/react-virtual'
import { VIRTUALIZER_TEST_INITIAL_RECT } from './constants'

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

function Probe({ onCount }: { onCount: (n: number) => void }) {
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: 20,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    initialRect: VIRTUALIZER_TEST_INITIAL_RECT,
    // jsdom does not lay out; feed the named rect explicitly.
    observeElementRect: (_instance, cb) => {
      cb(VIRTUALIZER_TEST_INITIAL_RECT)
      return () => {}
    },
  })
  const itemCount = virtualizer.getVirtualItems().length
  useEffect(() => {
    onCount(itemCount)
  }, [itemCount, onCount])
  return (
    <div
      ref={parentRef}
      style={{
        height: VIRTUALIZER_TEST_INITIAL_RECT.height,
        width: VIRTUALIZER_TEST_INITIAL_RECT.width,
        overflow: 'auto',
      }}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            style={{
              position: 'absolute',
              top: 0,
              transform: `translateY(${row.start}px)`,
              height: row.size,
              width: '100%',
            }}
          />
        ))}
      </div>
    </div>
  )
}

describe('virtualizer initialRect', () => {
  it('uses VIRTUALIZER_TEST_INITIAL_RECT so jsdom yields visible rows', async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)

    let seen = 0
    await act(async () => {
      root!.render(
        <Probe
          onCount={(n) => {
            seen = n
          }}
        />,
      )
    })

    // With a 600px viewport and 40px rows (+ overscan), expect more than one row.
    expect(VIRTUALIZER_TEST_INITIAL_RECT).toEqual({ width: 800, height: 600 })
    expect(seen).toBeGreaterThan(1)
  })
})
