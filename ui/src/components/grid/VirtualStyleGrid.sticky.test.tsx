/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Style } from '../../bridge'
import { __resetGridFocusForTests } from '../../lib/gridFocus'
import { HEADER_ROW_HEIGHT, VIRTUALIZER_TEST_INITIAL_RECT } from './constants'

vi.mock('@tanstack/react-virtual', () => ({
  defaultRangeExtractor: (range: { startIndex: number; endIndex: number }) => {
    const out: number[] = []
    for (let i = range.startIndex; i <= range.endIndex; i++) out.push(i)
    return out
  },
  useVirtualizer: (opts: {
    count: number
    estimateSize: (index: number) => number
    rangeExtractor?: (range: {
      startIndex: number
      endIndex: number
      overscan: number
      count: number
    }) => number[]
  }) => {
    const range = {
      startIndex: 0,
      endIndex: Math.max(0, opts.count - 1),
      overscan: 0,
      count: opts.count,
    }
    const indexes = opts.rangeExtractor?.(range) ?? [0, 1]
    return {
      getVirtualItems: () =>
        indexes.map((index) => ({
          index,
          key: index,
          start: index === 0 ? 0 : HEADER_ROW_HEIGHT,
          size: opts.estimateSize(index),
          end: 0,
          lane: 0,
        })),
      getTotalSize: () =>
        indexes.reduce((sum, index) => sum + opts.estimateSize(index), 0),
      measure: () => {},
      scrollToIndex: () => {},
      scrollToOffset: () => {},
    }
  },
}))

import { VirtualStyleGrid } from './VirtualStyleGrid'

function style(name: string, category: string): Style {
  return {
    name,
    source_file: 'D:/packs/core/styles.csv',
    prompt: `p:${name}`,
    negative_prompt: '',
    description: '',
    category,
    has_thumbnail: false,
    read_only: false,
  }
}

describe('VirtualStyleGrid sticky row wrapper', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  beforeEach(() => {
    __resetGridFocusForTests()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const height =
        Number.parseFloat(this.style.height) || VIRTUALIZER_TEST_INITIAL_RECT.height
      const width =
        Number.parseFloat(this.style.width) || VIRTUALIZER_TEST_INITIAL_RECT.width
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: width,
        bottom: height,
        width,
        height,
        toJSON() {
          return {}
        },
      }
    })
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
    __resetGridFocusForTests()
    vi.restoreAllMocks()
  })

  it('gives the active sticky header bg-sg-bg and sticky top 0; non-sticky rows omit bg-sg-bg', () => {
    const groups: Array<[string, Style[]]> = [
      ['BODY', [style('BODY_A', 'BODY'), style('BODY_B', 'BODY')]],
    ]

    act(() => {
      root!.render(
        <div
          style={{
            height: `${VIRTUALIZER_TEST_INITIAL_RECT.height}px`,
            width: `${VIRTUALIZER_TEST_INITIAL_RECT.width}px`,
            overflow: 'auto',
          }}
        >
          <VirtualStyleGrid
            groups={groups}
            collapsedCategories={new Set()}
            compactMode={false}
            windowed={false}
            onToggleCollapse={() => {}}
            onSelectAll={() => {}}
          />
        </div>,
      )
    })

    const sticky = host!.querySelector('[data-sg-row-kind="header"]') as HTMLElement | null
    const cards = host!.querySelector('[data-sg-row-kind="cards"]') as HTMLElement | null

    expect(sticky).not.toBeNull()
    expect(cards).not.toBeNull()
    expect(sticky!.classList.contains('bg-sg-bg')).toBe(true)
    expect(sticky!.style.position).toBe('sticky')
    expect(sticky!.style.top).toBe('0px')
    expect(cards!.classList.contains('bg-sg-bg')).toBe(false)
  })
})
