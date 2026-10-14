/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendToHost, WILDCARD_KIND_DECK, WILDCARD_KIND_DICE } from '../bridge'
import { DECK_NEW_ARIA, DECK_RESTART_ARIA, DECK_STRIP_ARIA } from '../lib/wildcardLabels'
import { useStylesStore } from '../store/stylesStore'
import { DeckStrip } from './DeckStrip'

vi.mock('../bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../bridge')>()),
  sendToHost: vi.fn(),
}))

let root: Root | null = null
let host: HTMLDivElement | null = null

beforeEach(() => {
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
  document.body.innerHTML = ''
  act(() => {
    useStylesStore.setState({
      activeWildcards: [],
      deckState: null,
    })
  })
  vi.mocked(sendToHost).mockClear()
})

describe('DeckStrip', () => {
  it('renders nothing when deckState is null even with a deck chip active', () => {
    act(() => {
      useStylesStore.setState({
        activeWildcards: [{ category: 'body', spec: '', kind: WILDCARD_KIND_DECK }],
        deckState: null,
      })
      root!.render(<DeckStrip />)
    })
    expect(document.querySelector(`[aria-label="${DECK_STRIP_ARIA}"]`)).toBeNull()
  })

  it('renders nothing when deckState is set but only dice chips are active', () => {
    act(() => {
      useStylesStore.setState({
        activeWildcards: [{ category: 'body', spec: '', kind: WILDCARD_KIND_DICE }],
        deckState: { seed: 5, index: 2 },
      })
      root!.render(<DeckStrip />)
    })
    expect(document.querySelector(`[aria-label="${DECK_STRIP_ARIA}"]`)).toBeNull()
  })

  it('shows seed and next draw for a deck chip with deckState', () => {
    act(() => {
      useStylesStore.setState({
        activeWildcards: [{ category: 'body', spec: '', kind: WILDCARD_KIND_DECK }],
        deckState: { seed: 5, index: 2 },
      })
      root!.render(<DeckStrip />)
    })
    const group = document.querySelector(`[aria-label="${DECK_STRIP_ARIA}"]`)
    expect(group).toBeTruthy()
    const text = group?.textContent ?? ''
    expect(text).toContain('seed 5')
    expect(text).toContain('#3')
  })

  it('sends restart and new-deck messages to the host', () => {
    act(() => {
      useStylesStore.setState({
        activeWildcards: [{ category: 'body', spec: '', kind: WILDCARD_KIND_DECK }],
        deckState: { seed: 5, index: 2 },
      })
      root!.render(<DeckStrip />)
    })
    const restart = document.querySelector(`[aria-label="${DECK_RESTART_ARIA}"]`)
    const neu = document.querySelector(`[aria-label="${DECK_NEW_ARIA}"]`)
    expect(restart).toBeTruthy()
    expect(neu).toBeTruthy()

    act(() => {
      restart!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(sendToHost).toHaveBeenCalledWith({ type: 'SG_DECK_RESTART' })

    act(() => {
      neu!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(sendToHost).toHaveBeenCalledWith({ type: 'SG_DECK_NEW' })
  })
})
