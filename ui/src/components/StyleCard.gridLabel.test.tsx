/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Style } from '../bridge'
import { __resetGridFocusForTests } from '../lib/gridFocus'
import { __resetLayerStackForTests } from '../lib/layerStack'
import { styleRowKey, useStylesStore } from '../store/stylesStore'
import {
  CARD_HEIGHT_NORMAL_PX,
  CARD_HEIGHT_WINDOWED_PX,
  CARD_ROW_HEIGHT_NORMAL_PX,
  CARD_ROW_HEIGHT_WINDOWED_PX,
  GALLERY_LABEL_HEIGHT_PX,
  ROW_GAP_NORMAL_PX,
  cardRowHeightPx,
  galleryCardHeightPx,
} from './grid/constants'
import { StyleCard } from './StyleCard'

vi.mock('../bridge', async () => {
  const actual = await vi.importActual<typeof import('../bridge')>('../bridge')
  return { ...actual, sendToHost: vi.fn() }
})

const LONG_NAME =
  'Cinematic Golden Hour Portrait With Soft Rim Lighting And Film Grain Supercalifragilisticexpialidocious'

function style(overrides: Partial<Style> = {}): Style {
  return {
    name: 'LIGHT_Long',
    display_name: LONG_NAME,
    source_file: 'webui/a.csv',
    prompt: 'p',
    negative_prompt: '',
    description: '',
    category: 'LIGHT',
    ...overrides,
  }
}

describe('grid tile row metrics', () => {
  it('row height constant = tile height + row gap, for both densities', () => {
    expect(CARD_ROW_HEIGHT_WINDOWED_PX).toBe(CARD_HEIGHT_WINDOWED_PX + ROW_GAP_NORMAL_PX)
    expect(CARD_ROW_HEIGHT_NORMAL_PX).toBe(CARD_HEIGHT_NORMAL_PX + ROW_GAP_NORMAL_PX)
    expect(cardRowHeightPx(true)).toBe(CARD_ROW_HEIGHT_WINDOWED_PX)
    expect(cardRowHeightPx(false)).toBe(CARD_ROW_HEIGHT_NORMAL_PX)
    expect([CARD_HEIGHT_WINDOWED_PX, CARD_HEIGHT_NORMAL_PX]).toEqual([34, 46])
  })
})

describe('StyleCard name on one line', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  const card = () => host!.querySelector<HTMLButtonElement>('[data-sg-card]')!

  beforeEach(() => {
    __resetGridFocusForTests()
    __resetLayerStackForTests()
    const s = style()
    useStylesStore.setState({
      styles: [s],
      duplicatesByName: new Map([[s.name, [s]]]),
      selectedStyles: [s],
      selectedKeySet: new Set([styleRowKey(s)]),
      favorites: new Set([styleRowKey(s)]),
      activeSource: null,
      thumbVersions: {},
      thumbKeys: new Set(),
      thumbKeysLoaded: true,
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
    __resetLayerStackForTests()
    vi.restoreAllMocks()
  })

  it.each([
    [true, CARD_HEIGHT_WINDOWED_PX, 'text-xs', 'p-2'],
    [false, CARD_HEIGHT_NORMAL_PX, 'text-sm', 'p-3'],
  ])('windowed=%s: a long name is truncated on one line, no title attribute', async (windowed, h, textClass, padClass) => {
    await act(async () => {
      root!.render(<StyleCard style={style()} windowed={windowed} cellRow={0} cellCol={0} tabIndex={0} />)
    })
    const b = card()
    expect(b.style.height).toBe(`${h}px`)
    expect(b.style.height).toBe(`${cardRowHeightPx(windowed) - ROW_GAP_NORMAL_PX}px`)
    const cardClasses = b.className.split(/\s+/)
    expect(cardClasses).toContain(padClass)
    expect(cardClasses).not.toContain('items-center')
    const label = b.querySelector<HTMLElement>('[data-sg-grid-label="true"]')!
    expect(label.textContent).toBe(LONG_NAME)
    expect(label.className).toBe(`${textClass} min-w-0 truncate pr-4 font-medium text-sg-text`)
    // The accessible name keeps the full style name; tooltips stay removed.
    expect(b.getAttribute('aria-label')).toBe(`${LONG_NAME} favorite`)
    expect(host!.querySelector('[title]')).toBeNull()
  })

  it('gallery card height and its name label are unchanged', async () => {
    const cardH = galleryCardHeightPx(146)
    await act(async () => {
      root!.render(
        <StyleCard style={style()} viewMode="gallery" galleryCardHeightPx={cardH} cellRow={0} cellCol={0} tabIndex={0} />,
      )
    })
    expect(cardH).toBe(146 + 44)
    expect(GALLERY_LABEL_HEIGHT_PX).toBe(44)
    const b = card()
    expect(b.style.height).toBe(`${cardH}px`)
    expect(b.className).not.toContain('items-center')
    const label = b.querySelector<HTMLElement>('[data-sg-gallery-label]')!
    expect(label.style.height).toBe('44px')
    expect(label.className).toBe(
      'shrink-0 px-2 py-1.5 text-xs font-medium text-sg-text text-left line-clamp-2 break-words',
    )
    expect(host!.querySelector('[title]')).toBeNull()
  })
})
