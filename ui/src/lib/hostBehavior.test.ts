/** @vitest-environment jsdom */
/**
 * Extension host (web/js/style_grid.js), driven as ComfyUI drives it: the real
 * module is imported with /scripts/app.js and /scripts/api.js stubbed
 * (ui/test-stubs, aliased in vite.config.ts), Style Grid nodes are fake
 * litegraph nodes, and the panel's messages are posted from its iframe window.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Fn = (...args: never[]) => unknown
type Widget = {
  name: string
  value: unknown
  type?: string
  element?: HTMLElement
  callback?: Fn
  options?: Record<string, unknown>
  serialize?: boolean
  hidden?: boolean
}
type FakeNode = {
  id: number
  comfyClass: string
  widgets: Widget[]
  size: [number, number]
  graph: { setDirtyCanvas: ReturnType<typeof vi.fn> }
  addWidget: (type: string, name: string, value: unknown, callback: Fn) => Widget
  addDOMWidget?: (name: string, type: string, element: HTMLElement, options: Record<string, unknown>) => Widget
  computeSize: () => [number, number]
  setSize: (size: [number, number]) => void
  onSerialize?: (o: Record<string, unknown>) => void
  onConfigure?: (o: Record<string, unknown>) => void
  onRemoved?: () => void
}
type Extension = {
  nodeCreated: (node: FakeNode) => Promise<void>
  loadedGraphNode: (node: FakeNode) => void
}
type Stub = {
  app: {
    graph: { _nodes: FakeNode[] }
    extensionManager: { workflow: { activeWorkflow: { changeTracker: { captureCanvasState: Fn } } } }
  }
  registered: Extension[]
}
type Style = { name: string; source_file: string; prompt: string; negative_prompt: string; category: string }

const A = 'data/a.csv'
const BASE: Style[] = [
  { name: 'BODY_Tall', source_file: A, prompt: 'tall', negative_prompt: 'short', category: 'BODY' },
  { name: 'HAIR_Red', source_file: A, prompt: 'red hair', negative_prompt: '', category: 'HAIR' },
]

let catalog: Style[] = BASE
let fetchMock: ReturnType<typeof vi.fn>
let stub: Stub
let ext: Extension
let posted: Array<Record<string, unknown>>

const byCategory = (styles: Style[]) => {
  const out: Record<string, Style[]> = {}
  for (const s of styles) (out[s.category] ||= []).push(s)
  return out
}
const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0))
}
const stylesFetches = () => fetchMock.mock.calls.filter(([url]) => url === '/style_grid/styles').length

async function loadHost() {
  vi.resetModules()
  await import('../../../web/js/style_grid.js')
  stub = (globalThis as unknown as { __sgComfyStub: Stub }).__sgComfyStub
  ext = stub.registered[stub.registered.length - 1]
}

function makeNode(id: number, { dom = true }: { dom?: boolean } = {}): FakeNode {
  const widgets: Widget[] = [
    { name: 'text', value: '', element: document.createElement('textarea') },
    { name: 'negative_text', value: '', element: document.createElement('textarea') },
    { name: 'active_source', value: '' },
    { name: 'deck_seed', value: 0 },
    { name: 'deck_index', value: 0 },
    { name: 'seed', value: 1 },
  ]
  const node: FakeNode = {
    id,
    comfyClass: 'StyleGridNode',
    widgets,
    size: [400, 300],
    graph: { setDirtyCanvas: vi.fn() },
    addWidget(type, name, value, callback) {
      const w = { type, name, value, callback }
      widgets.push(w)
      return w
    },
    computeSize: () => [400, 200],
    setSize(size) {
      node.size = size
    },
  }
  if (dom) {
    node.addDOMWidget = (name, type, element, options) => {
      const w: Widget = { name, type, element, options, value: undefined }
      widgets.push(w)
      document.body.appendChild(element)
      return w
    }
  }
  return node
}

async function addNode(node: FakeNode, text = '', neg = '') {
  stub.app.graph._nodes.push(node)
  await ext.nodeCreated(node)
  widget(node, 'text').value = text
  widget(node, 'negative_text').value = neg
  return node
}

/** A node loaded from a workflow: sg_applied (or none, for a legacy workflow), then loadedGraphNode. */
async function loadNode(id: number, text: string, neg: string, entries?: Style[]) {
  const node = await addNode(makeNode(id), text, neg)
  const data: Record<string, unknown> = {}
  if (entries) {
    data.sg_applied = {
      v: 1,
      entries: entries.map(({ name, source_file, prompt, negative_prompt }) => ({ name, source_file, prompt, negative_prompt })),
    }
  }
  node.onConfigure!(data)
  ext.loadedGraphNode(node)
  return node
}

const widget = (node: FakeNode, name: string) => node.widgets.find((w) => w.name === name)!
const textOf = (node: FakeNode) => [widget(node, 'text').value, widget(node, 'negative_text').value]
const chipRow = (node: FakeNode) => widget(node, 'sg_chips').element!
const chipLabels = (node: FakeNode) =>
  [...chipRow(node).querySelectorAll('.sg-chip-label')].map((e) => e.textContent)
const ledgerNames = (node: FakeNode) => {
  const o: Record<string, unknown> = {}
  node.onSerialize!(o)
  const ledger = o.sg_applied as { entries: Array<{ name: string; source_file: string }> } | undefined
  return ledger ? ledger.entries.map((e) => `${e.source_file}:${e.name}`) : undefined
}
const removeButton = (node: FakeNode, label: string) =>
  chipRow(node).querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!

const frame = () => document.querySelector<HTMLIFrameElement>('#sg-overlay iframe')!
const overlayShown = () => document.getElementById('sg-overlay')?.style.display === 'block'
function send(data: unknown, { origin = window.location.origin, source = frame().contentWindow } = {}) {
  window.dispatchEvent(new MessageEvent('message', { data, origin, source: source as Window }))
}
function catchPosts() {
  const win = frame().contentWindow as Window & { __sgCaught?: boolean }
  if (win.__sgCaught) return
  win.__sgCaught = true
  win.postMessage = ((msg: Record<string, unknown>) => {
    posted.push(msg)
  }) as typeof win.postMessage
}
function browse(node: FakeNode) {
  widget(node, 'Browse Styles').callback!()
  catchPosts()
}
/** First open: the panel loads, says SG_READY, and the host rehydrates it. */
async function openPanel(node: FakeNode) {
  browse(node)
  send({ type: 'SG_READY' })
  await flush()
}
const apply = (s: Style) =>
  send({ type: 'SG_APPLY', styleId: s.name, prompt: s.prompt, neg: s.negative_prompt, source_file: s.source_file })

beforeEach(async () => {
  catalog = BASE
  posted = []
  fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => (url === '/style_grid/check_update' ? { changed: false } : { categories: byCategory(catalog) }),
  }))
  vi.stubGlobal('fetch', fetchMock)
  await loadHost()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('frame messages', () => {
  it('only messages from the panel window and origin, and only well-formed ones, reach the node', async () => {
    const node = await addNode(makeNode(1))
    await openPanel(node)
    const msg = { type: 'SG_APPLY', styleId: 'BODY_Tall', prompt: 'tall', neg: 'short', source_file: A }
    send(msg, { origin: 'http://elsewhere.test' })
    send(msg, { source: window })
    send({ ...msg, prompt: 1 })
    expect(textOf(node)).toEqual(['', ''])
    send(msg)
    expect(textOf(node)).toEqual(['tall', 'short'])
  })

  it('SG_REORDER_STYLES (styleRowKeys) reorders the prompt and the node chips', async () => {
    const node = await addNode(makeNode(1))
    await openPanel(node)
    apply(BASE[0])
    apply(BASE[1])
    expect(chipLabels(node)).toEqual(['Tall', 'Red'])
    send({ type: 'SG_REORDER_STYLES', styleIds: [`${A}\0HAIR_Red`, `${A}\0BODY_Tall`] })
    expect(textOf(node)).toEqual(['red hair, tall', 'short'])
    expect(chipLabels(node)).toEqual(['Red', 'Tall'])
    expect(ledgerNames(node)).toEqual([`${A}:HAIR_Red`, `${A}:BODY_Tall`])
  })

  it('SG_REORDER_WILDCARDS ({category, spec, kind}) reorders the wildcard tokens', async () => {
    const node = await addNode(makeNode(1))
    await openPanel(node)
    send({ type: 'SG_WILDCARD_CATEGORY', category: 'body', kind: 'sg' })
    send({ type: 'SG_WILDCARD_SLICE', category: 'hair', spec: 'Red', kind: 'sgd' })
    expect(textOf(node)[0]).toBe('{sg:body}, {sgd:hair:Red}')
    send({
      type: 'SG_REORDER_WILDCARDS',
      categories: [
        { category: 'hair', spec: 'Red', kind: 'sgd' },
        { category: 'body', spec: '', kind: 'sg' },
      ],
    })
    expect(textOf(node)[0]).toBe('{sgd:hair:Red}, {sg:body}')
    expect(chipLabels(node)).toEqual(['hair (slice)', 'body'])
  })

  it('SG_CLEAR_ALL empties both prompts, the ledger, the chips and the tray', async () => {
    const node = await addNode(makeNode(1))
    await openPanel(node)
    apply(BASE[0])
    widget(node, 'text').value = 'my words, tall, {sg:hair}'
    posted = []
    send({ type: 'SG_CLEAR_ALL' })
    expect(textOf(node)).toEqual(['', ''])
    expect(ledgerNames(node)).toEqual([])
    expect(chipLabels(node)).toEqual([])
    expect(posted.map((m) => m.type)).toEqual(['SG_WILDCARDS_ACTIVE', 'SG_CLEAR_SELECTION'])
  })

  it('SG_STYLE_RENAMED remaps every node with that (source, name), then reloads the catalog', async () => {
    const open = await addNode(makeNode(1))
    await openPanel(open)
    apply(BASE[0])
    const other = await loadNode(2, 'tall', 'short', [BASE[0]])
    const otherPack = await loadNode(3, 'tall', 'short', [{ ...BASE[0], source_file: 'imports/b.csv' }])
    catalog = [{ ...BASE[0], name: 'BODY_Huge' }, BASE[1]]
    fetchMock.mockClear()
    send({ type: 'SG_STYLE_RENAMED', old_name: 'BODY_Tall', new_name: 'BODY_Huge', source_file: A })
    expect(ledgerNames(open)).toEqual([`${A}:BODY_Huge`])
    expect(ledgerNames(other)).toEqual([`${A}:BODY_Huge`])
    expect(ledgerNames(otherPack)).toEqual(['imports/b.csv:BODY_Tall'])
    expect(chipLabels(other)).toEqual(['Huge'])
    await flush()
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/style_grid/check_update', '/style_grid/styles'])
    expect(textOf(open)).toEqual(['tall', 'short'])
  })
})

describe('SG_REFRESH with a style gone from the library', () => {
  it('the panel node loses the style and its chip; another node keeps it, struck through', async () => {
    const open = await addNode(makeNode(1))
    await openPanel(open)
    apply(BASE[0])
    apply(BASE[1])
    const other = await loadNode(2, 'tall', 'short', [BASE[0]])
    catalog = [BASE[1]]
    send({ type: 'SG_REFRESH', quiet_vanished: true })
    await flush()
    expect(textOf(open)).toEqual(['red hair', ''])
    expect(ledgerNames(open)).toEqual([`${A}:HAIR_Red`])
    expect(chipLabels(open)).toEqual(['Red'])
    expect(textOf(other)).toEqual(['tall', 'short'])
    expect(ledgerNames(other)).toEqual([`${A}:BODY_Tall`])
    expect(chipRow(other).querySelector('.sg-chip--missing .sg-chip-label')?.textContent).toBe('Tall')
  })
})

describe('the panel', () => {
  it('Browse Styles toggles; a chip body opens the panel or keeps it open, never closes it', async () => {
    const node = await addNode(makeNode(1))
    await openPanel(node)
    apply(BASE[0])
    browse(node)
    expect(overlayShown()).toBe(false)
    const body = chipRow(node).querySelector<HTMLButtonElement>('.sg-chip-body')!
    body.click()
    await flush()
    expect(overlayShown()).toBe(true)
    body.click()
    await flush()
    expect(overlayShown()).toBe(true)
  })

  it('opening again reuses the filled catalog: one GET /style_grid/styles', async () => {
    const node = await addNode(makeNode(1))
    await openPanel(node)
    expect(stylesFetches()).toBe(1)
    browse(node)
    browse(node)
    await flush()
    expect(overlayShown()).toBe(true)
    expect(stylesFetches()).toBe(1)
    expect(posted.filter((m) => m.type === 'SG_INIT')).toHaveLength(2)
  })

  it('a failed SG_REFRESH leaves no stale catalog: the next open fetches it again', async () => {
    const node = await addNode(makeNode(1))
    await openPanel(node)
    const served = fetchMock.getMockImplementation() as (url: string) => Promise<unknown>
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/style_grid/styles') throw new Error('offline')
      return served(url)
    })
    catalog = [BASE[1]]
    send({ type: 'SG_REFRESH', quiet_vanished: true })
    await flush()
    expect(posted.some((m) => m.type === 'SG_TOAST' && m.message === 'Refresh failed')).toBe(true)
    fetchMock.mockImplementation(served)
    posted = []
    browse(node)
    browse(node)
    await flush()
    expect(overlayShown()).toBe(true)
    expect(stylesFetches()).toBe(3)
    const init = posted.filter((m) => m.type === 'SG_INIT')
    expect(init).toHaveLength(1)
    expect((init[0].styles as Style[]).map((s) => s.name)).toEqual(['HAIR_Red'])
  })

  it('a legacy node loads the catalog once for its chips; the panel then reuses it', async () => {
    const legacy = await loadNode(1, 'tall, red hair', 'short')
    expect(chipLabels(legacy)).toEqual([])
    await flush()
    expect(chipLabels(legacy)).toEqual(['Tall', 'Red'])
    expect(ledgerNames(legacy)).toBeUndefined()
    await openPanel(legacy)
    expect(stylesFetches()).toBe(1)
    expect(posted.filter((m) => m.type === 'SG_STYLE_APPLIED').map((m) => (m.style as Style).name)).toEqual([
      'BODY_Tall',
      'HAIR_Red',
    ])
  })
})

describe('the sg_chips widget', () => {
  it('is a DOM widget before Browse Styles with both serialize flags off, hidden while empty', async () => {
    const node = await addNode(makeNode(1))
    const names = node.widgets.map((w) => w.name)
    expect(names.indexOf('sg_chips')).toBe(names.indexOf('Browse Styles') - 1)
    const chips = widget(node, 'sg_chips')
    expect(chips.serialize).toBe(false)
    expect(chips.options!.serialize).toBe(false)
    expect(chips.hidden).toBe(true)
  })

  it('without addDOMWidget the node has no chips and keeps Browse Styles', async () => {
    const node = await addNode(makeNode(1, { dom: false }))
    expect(node.widgets.map((w) => w.name)).not.toContain('sg_chips')
    expect(node.widgets.map((w) => w.name)).toContain('Browse Styles')
  })

  it('✕ on a style chip of the panel node: SG_UNAPPLY path, tray rebuilt, one undo step', async () => {
    const node = await addNode(makeNode(1))
    await openPanel(node)
    apply(BASE[0])
    apply(BASE[1])
    const capture = vi.fn()
    stub.app.extensionManager.workflow.activeWorkflow.changeTracker.captureCanvasState = capture
    posted = []
    removeButton(node, 'Remove BODY_Tall').click()
    expect(textOf(node)).toEqual(['red hair', ''])
    expect(ledgerNames(node)).toEqual([`${A}:HAIR_Red`])
    expect(chipLabels(node)).toEqual(['Red'])
    expect(posted.map((m) => m.type)).toEqual(['SG_CLEAR_SELECTION', 'SG_STYLE_APPLIED', 'SG_WILDCARDS_ACTIVE'])
    expect((posted[1].style as Style).name).toBe('HAIR_Red')
    expect(capture).toHaveBeenCalledTimes(1)
  })

  it('✕ on a node the panel is not open for changes that node and sends nothing to the panel', async () => {
    const open = await addNode(makeNode(1))
    await openPanel(open)
    const other = await loadNode(2, 'tall, {sg:hair}', 'short', [BASE[0]])
    expect(chipLabels(other)).toEqual(['Tall', 'hair'])
    posted = []
    removeButton(other, 'Remove BODY_Tall').click()
    removeButton(other, 'Remove wildcard hair').click()
    expect(textOf(other)).toEqual(['', ''])
    expect(chipLabels(other)).toEqual([])
    expect(posted).toEqual([])
  })

  it('a workflow load builds the chips from sg_applied; typing updates them after 150 ms', async () => {
    const node = await loadNode(1, 'tall', 'short', [BASE[0]])
    expect(chipLabels(node)).toEqual(['Tall'])
    vi.useFakeTimers()
    const text = widget(node, 'text')
    text.value = 'tal'
    text.element!.dispatchEvent(new Event('input'))
    vi.advanceTimersByTime(149)
    expect(chipLabels(node)).toEqual(['Tall'])
    vi.advanceTimersByTime(1)
    expect(chipLabels(node)).toEqual([])
  })

  it('removing the node removes its chip row', async () => {
    const node = await loadNode(1, 'tall', 'short', [BASE[0]])
    const row = chipRow(node)
    expect(row.isConnected).toBe(true)
    node.onRemoved!()
    expect(row.isConnected).toBe(false)
  })
})
