/** @vitest-environment jsdom */
import { act, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  __resetGridFocusForTests,
  getFocusedCell,
  gridFocusStore,
  setFocusedCell,
  useFocusedCell,
  useFocusedColForRow,
  useFocusedRow,
} from './gridFocus'

describe('gridFocus store', () => {
  beforeEach(() => {
    __resetGridFocusForTests()
  })

  afterEach(() => {
    __resetGridFocusForTests()
  })

  it('exposes focusedCell / setFocusedCell on the module store', () => {
    expect(gridFocusStore.focusedCell).toBeNull()
    setFocusedCell({ row: 2, col: 1 })
    expect(getFocusedCell()).toEqual({ row: 2, col: 1 })
    expect(gridFocusStore.focusedCell).toEqual({ row: 2, col: 1 })
    gridFocusStore.setFocusedCell(null)
    expect(getFocusedCell()).toBeNull()
  })
})

describe('useFocusedCell', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null
  let seen: Array<ReturnType<typeof getFocusedCell>> = []

  beforeEach(() => {
    __resetGridFocusForTests()
    seen = []
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
  })

  it('subscribes with a narrow selector and updates on setFocusedCell', () => {
    function Probe() {
      const cell = useFocusedCell()
      const [, setTick] = useState(0)
      useEffect(() => {
        seen.push(cell)
      }, [cell])
      return (
        <button type="button" onClick={() => setTick((n) => n + 1)}>
          {cell ? `${cell.row},${cell.col}` : 'none'}
        </button>
      )
    }

    act(() => {
      root!.render(<Probe />)
    })
    expect(seen.at(-1)).toBeNull()

    act(() => {
      setFocusedCell({ row: 0, col: 1 })
    })
    expect(seen.at(-1)).toEqual({ row: 0, col: 1 })
    expect(host!.textContent).toBe('0,1')
  })
})

describe('useFocusedRow / useFocusedColForRow', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  beforeEach(() => {
    __resetGridFocusForTests()
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
  })

  it('row hook ignores col-only moves; col hook is row-scoped', () => {
    const rowsSeen: Array<number | null> = []
    const col0Seen: Array<number | null> = []
    const col1Seen: Array<number | null> = []

    function Probe() {
      const row = useFocusedRow()
      const col0 = useFocusedColForRow(0)
      const col1 = useFocusedColForRow(1)
      useEffect(() => {
        rowsSeen.push(row)
      }, [row])
      useEffect(() => {
        col0Seen.push(col0)
      }, [col0])
      useEffect(() => {
        col1Seen.push(col1)
      }, [col1])
      return (
        <span>
          {row ?? 'n'}:{col0 ?? 'n'}:{col1 ?? 'n'}
        </span>
      )
    }

    act(() => {
      root!.render(<Probe />)
    })
    expect(rowsSeen.at(-1)).toBeNull()
    expect(col0Seen.at(-1)).toBeNull()
    expect(col1Seen.at(-1)).toBeNull()

    act(() => {
      setFocusedCell({ row: 0, col: 0 })
    })
    expect(rowsSeen.at(-1)).toBe(0)
    expect(col0Seen.at(-1)).toBe(0)
    expect(col1Seen.at(-1)).toBeNull()

    const rowUpdates = rowsSeen.length
    act(() => {
      setFocusedCell({ row: 0, col: 2 })
    })
    // Same row — useFocusedRow must not emit a new value.
    expect(rowsSeen.length).toBe(rowUpdates)
    expect(col0Seen.at(-1)).toBe(2)
    expect(col1Seen.at(-1)).toBeNull()

    act(() => {
      setFocusedCell({ row: 1, col: 0 })
    })
    expect(rowsSeen.at(-1)).toBe(1)
    expect(col0Seen.at(-1)).toBeNull()
    expect(col1Seen.at(-1)).toBe(0)
  })
})
