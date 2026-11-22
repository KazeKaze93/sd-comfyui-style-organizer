/** @vitest-environment jsdom */
/**
 * ComfyUI side of the platform seam (lib/platform.ts): the flag values and what
 * each one changes in the shared WebUI iframe sources.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { sendToHost, WILDCARD_KIND_DECK, type Style } from './bridge'
import { SelectedBar } from './components/SelectedBar'
import { CategoryMenuItems } from './components/CategoryMenuItems'
import { StyleCard } from './components/StyleCard'
import { DECK_STRIP_ARIA } from './lib/deckLabels'
import { setFrameFullscreen, WINDOWED_SIZE_KEY } from './lib/frameFullscreen'
import { __resetFocusSourceForTests } from './lib/focusSource'
import { __resetGridFocusForTests } from './lib/gridFocus'
import { __resetLayerStackForTests } from './lib/layerStack'
import { PLATFORM } from './lib/platform'
import { tagKeySet } from './lib/tagIdentity'
import { styleRowKey, useStylesStore } from './store/stylesStore'

vi.mock('./bridge', async () => {
  const actual = await vi.importActual<typeof import('./bridge')>('./bridge')
  return { ...actual, sendToHost: vi.fn() }
})

const sendToHostMock = vi.mocked(sendToHost)
const sentTypes = () => sendToHostMock.mock.calls.map(([m]) => m.type)
const HERE = path.dirname(fileURLToPath(import.meta.url))

const row = (name: string, extra: Partial<Style> = {}): Style => ({
  name,
  source_file: 'data/a.csv',
  prompt: `p:${name}`,
  negative_prompt: '',
  description: '',
  category: 'BODY',
  ...extra,
})

describe('ComfyUI platform values', () => {
  it('match the port decisions', () => {
    expect({
      lora: PLATFORM.lora,
      hostTabs: PLATFORM.hostTabs,
      previewGeneration: PLATFORM.previewGeneration,
      deck: PLATFORM.deck,
      fullscreenMode: PLATFORM.fullscreenMode,
      sourceChange: PLATFORM.sourceChange,
      sourceIdPrefixes: [...PLATFORM.sourceIdPrefixes],
      sharedSourceIds: PLATFORM.sharedSourceIds,
      samplesCopyToData: PLATFORM.samplesCopyToData,
      reapplyEditedStyles: PLATFORM.reapplyEditedStyles,
      shuffleScopeLabel: PLATFORM.shuffleScopeLabel,
    }).toEqual({
      lora: false,
      hostTabs: false,
      previewGeneration: false,
      deck: true,
      fullscreenMode: 'frame-element',
      sourceChange: 'user-only',
      sourceIdPrefixes: ['data', 'imports', 'samples'],
      sharedSourceIds: false,
      samplesCopyToData: true,
      reapplyEditedStyles: true,
      shuffleScopeLabel: 'queue run',
    })
    expect(PLATFORM.conflictKeySet).toBe(tagKeySet)
  })
})

describe('frame-element fullscreen (lib/frameFullscreen.ts)', () => {
  let wrapper: HTMLDivElement
  beforeEach(() => {
    localStorage.clear()
    wrapper = document.createElement('div')
    const frame = document.createElement('iframe')
    wrapper.appendChild(frame)
    document.body.appendChild(wrapper)
    Object.assign(wrapper.style, { top: '90px', right: '20px', width: '900px', height: '600px' })
    Object.defineProperty(window, 'frameElement', { configurable: true, value: frame })
  })
  afterEach(() => {
    Object.defineProperty(window, 'frameElement', { configurable: true, value: null })
    wrapper.remove()
  })

  it('entering saves the windowed geometry and fills the viewport; leaving restores it', () => {
    expect(setFrameFullscreen(true)).toBe(true)
    expect(JSON.parse(localStorage.getItem(WINDOWED_SIZE_KEY)!)).toEqual({
      top: '90px',
      right: '20px',
      width: '900px',
      height: '600px',
    })
    expect([wrapper.style.width, wrapper.style.height, wrapper.style.resize]).toEqual(['100vw', '100vh', 'none'])
    expect(setFrameFullscreen(false)).toBe(false)
    expect([wrapper.style.top, wrapper.style.right, wrapper.style.width, wrapper.style.height]).toEqual([
      '90px',
      '20px',
      '900px',
      '600px',
    ])
    expect(wrapper.style.resize).toBe('both')
  })

  it('not embedded: nothing changes', () => {
    Object.defineProperty(window, 'frameElement', { configurable: true, value: null })
    expect(setFrameFullscreen(true)).toBeNull()
  })
})

describe('App on the ComfyUI platform', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null
  let wrapper: HTMLDivElement
  const button = (label: string) =>
    [...host!.querySelectorAll<HTMLButtonElement>('[data-sg-header] button')].find(
      (b) => b.getAttribute('aria-label') === label,
    )!
  const fromHost = async (data: unknown) => {
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { data, origin: window.location.origin, source: window.parent }))
    })
  }

  beforeEach(async () => {
    __resetGridFocusForTests()
    __resetLayerStackForTests()
    __resetFocusSourceForTests()
    sendToHostMock.mockClear()
    localStorage.clear()
    localStorage.setItem(WINDOWED_SIZE_KEY, JSON.stringify({ top: '70px', right: '10px', width: '800px', height: '500px' }))
    wrapper = document.createElement('div')
    const frame = document.createElement('iframe')
    wrapper.appendChild(frame)
    document.body.appendChild(wrapper)
    Object.defineProperty(window, 'frameElement', { configurable: true, value: frame })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<App />)
    })
  })
  afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    wrapper.remove()
    Object.defineProperty(window, 'frameElement', { configurable: true, value: null })
    vi.unstubAllGlobals()
    useStylesStore.setState({ deckState: null, activeWildcards: [] })
  })

  it('keeps sg_windowed_size on mount; Fullscreen resizes the frame and never asks the host', async () => {
    expect(localStorage.getItem(WINDOWED_SIZE_KEY)).not.toBeNull()
    Object.assign(wrapper.style, { top: '70px', right: '10px', width: '800px', height: '500px' })
    await act(async () => button('Fullscreen').click())
    expect(wrapper.style.width).toBe('100vw')
    expect(button('Exit fullscreen')).toBeDefined()
    await act(async () => button('Exit fullscreen').click())
    expect(wrapper.style.width).toBe('800px')
    expect(sentTypes()).not.toContain('SG_SET_FULLSCREEN')
  })

  it('SG_INIT without a tab loads the catalog; SG_DECK_STATE reaches the store', async () => {
    await fromHost({ type: 'SG_INIT', styles: [row('BODY_A')] })
    expect(useStylesStore.getState().styles.map((s) => s.name)).toEqual(['BODY_A'])
    expect(useStylesStore.getState().stylesLoaded).toBe(true)
    await fromHost({ type: 'SG_DECK_STATE', seed: 11, index: 3 })
    expect(useStylesStore.getState().deckState).toEqual({ seed: 11, index: 3 })
  })

  it('a catalog load never sends SG_SOURCE_CHANGE (sourceChange user-only)', async () => {
    localStorage.setItem('sg_v2_last_source_txt2img', 'data/a.csv')
    await fromHost({ type: 'SG_INIT', styles: [row('BODY_A')] })
    await fromHost({ type: 'SG_STYLES_UPDATE', styles: [row('BODY_A'), row('BODY_B')] })
    expect(sentTypes()).not.toContain('SG_SOURCE_CHANGE')
    await act(async () => useStylesStore.getState().setActiveSource(null))
    expect(sendToHostMock).toHaveBeenLastCalledWith({ type: 'SG_SOURCE_CHANGE', source: null })
  })

  it('no tab badge and the title is just the product name', () => {
    expect(host!.querySelector('[data-sg-tab-badge]')).toBeNull()
    expect(host!.querySelector('[data-sg-header-title]')!.getAttribute('aria-label')).toBe('Style Grid')
  })
})

describe('DeckStrip in the SelectedBar (PLATFORM.deck)', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null
  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    useStylesStore.setState({ deckState: null, activeWildcards: [], selectedStyles: [] })
  })

  it('renders after the wildcard chips once a deck chip and the deck state are there', async () => {
    useStylesStore.setState({
      selectedStyles: [],
      activeWildcards: [{ category: 'body', spec: '', kind: WILDCARD_KIND_DECK }],
      deckState: null,
    })
    await act(async () => root!.render(<SelectedBar />))
    expect(host!.querySelector(`[aria-label="${DECK_STRIP_ARIA}"]`)).toBeNull()
    await act(async () => useStylesStore.setState({ deckState: { seed: 4, index: 1 } }))
    const strip = host!.querySelector(`[aria-label="${DECK_STRIP_ARIA}"]`)!
    expect(strip).not.toBeNull()
    expect(strip.textContent).toContain('4')
  })
})

describe('conflicts use tagKeySet (the node drop_shared_tags identity)', () => {
  it('a weighted tag conflicts with its bare negative; WebUI exact tokens would miss it', () => {
    const a = row('SKIN_Pale', { prompt: '(pale skin:1.2), freckles' })
    const b = row('SKIN_Tan', { prompt: 'tan', negative_prompt: 'pale skin' })
    useStylesStore.setState({
      styles: [a, b],
      selectedStyles: [a, b],
      selectedKeySet: new Set([styleRowKey(a), styleRowKey(b)]),
      dismissedConflictPairs: new Set(),
    })
    useStylesStore.getState().detectConflicts()
    expect(useStylesStore.getState().conflicts.map((c) => [c.styleA, c.styleB])).toEqual([['SKIN_Tan', 'SKIN_Pale']])
  })
})

describe('no UI path sends preview generation or SG_SET_FULLSCREEN', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null
  beforeEach(() => {
    __resetLayerStackForTests()
    sendToHostMock.mockClear()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    __resetLayerStackForTests()
  })

  it('the tile menu has no Generate preview; Upload preview… is there', async () => {
    const s = row('BODY_A')
    useStylesStore.setState({ styles: [s], duplicatesByName: new Map([[s.name, [s]]]), selectedStyles: [], selectedKeySet: new Set() })
    await act(async () => root!.render(<StyleCard style={s} viewMode="grid" cellRow={0} cellCol={0} tabIndex={0} />))
    const card = host!.querySelector<HTMLElement>('[data-sg-card]')!
    await act(async () => {
      card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }))
    })
    const labels = [...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent?.trim())
    expect(labels).not.toContain('Generate preview')
    expect(labels).toContain('Upload preview…')
  })

  it('the category menu has no Generate previews…', async () => {
    await act(async () => root!.render(<CategoryMenuItems category="BODY" onClose={() => {}} />))
    expect(host!.textContent).not.toContain('Generate previews')
  })

  it('every sender of these types in the sources sits behind its platform flag', () => {
    const gated: Record<string, RegExp> = {
      SG_GENERATE_PREVIEW: /PLATFORM\.previewGeneration/,
      SG_GENERATE_CATEGORY_PREVIEWS: /PLATFORM\.previewGeneration/,
      SG_SET_FULLSCREEN: /PLATFORM\.fullscreenMode === 'frame-element'/,
    }
    const files = ['components/StyleCard.tsx', 'components/CategoryMenuItems.tsx', 'App.tsx']
    const sources = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(HERE, f), 'utf8')]))
    for (const [type, guard] of Object.entries(gated)) {
      const hits = files.filter((f) => sources[f].includes(`type: '${type}'`))
      expect(hits.length).toBeGreaterThan(0)
      for (const f of hits) expect(sources[f]).toMatch(guard)
    }
    // Batch Skip / Cancel only render for a batch report, which this host never sends
    // (web/js has no SG_BATCH_PROGRESS); the host guard drops them as well.
    expect(useStylesStore.getState().previewBatch).toBeNull()
  })
})
