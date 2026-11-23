/**
 * Extension host (web/js): message validation (frame_messages.js) and the
 * actions behind Clear, refresh, rename and preview upload (host_actions.js).
 */
import { describe, expect, it, vi } from 'vitest'
import { FRAME_MESSAGE_TYPES, parseFrameMessage } from '../../../web/js/frame_messages.js'
import {
  clearNodePrompts,
  ledgerKey,
  refreshCatalog,
  renameLedgerEntries,
  uploadPreview,
  vanishedToastMessage,
} from '../../../web/js/host_actions.js'

type Entry = { name: string; source_file: string; prompt: string; negative_prompt: string }
type Widget = { name: string; value: string }
type FakeNode = { id: number; widgets: Widget[]; graph: { setDirtyCanvas: ReturnType<typeof vi.fn> } }

function makeNode(id: number, text: string, neg = ''): FakeNode {
  return {
    id,
    widgets: [
      { name: 'text', value: text },
      { name: 'negative_text', value: neg },
      { name: 'active_source', value: '' },
    ],
    graph: { setDirtyCanvas: vi.fn() },
  }
}
const widget = (node: FakeNode, name: string) => node.widgets.find((w) => w.name === name)!.value
const entry = (name: string, source_file: string, prompt = '', negative_prompt = ''): Entry => ({
  name,
  source_file,
  prompt,
  negative_prompt,
})
const ledgerOf = (...entries: Entry[]) => new Map(entries.map((e) => [ledgerKey(e.name, e.source_file), e]))

describe('parseFrameMessage', () => {
  const valid: Record<string, Record<string, unknown>> = {
    SG_READY: { type: 'SG_READY' },
    SG_CLOSE_REQUEST: { type: 'SG_CLOSE_REQUEST' },
    SG_CLEAR_ALL: { type: 'SG_CLEAR_ALL' },
    SG_DECK_RESTART: { type: 'SG_DECK_RESTART' },
    SG_DECK_NEW: { type: 'SG_DECK_NEW' },
    SG_REFRESH: { type: 'SG_REFRESH', quiet_vanished: true },
    SG_APPLY: { type: 'SG_APPLY', styleId: 'A', prompt: 'p', neg: '', source_file: 'data/a.csv' },
    SG_UNAPPLY: { type: 'SG_UNAPPLY', styleId: 'A', source_file: 'data/a.csv' },
    SG_UPLOAD_PREVIEW: { type: 'SG_UPLOAD_PREVIEW', styleId: 'A', source: 'data/a.csv' },
    SG_WILDCARD_CATEGORY: { type: 'SG_WILDCARD_CATEGORY', category: 'body', kind: 'sgd' },
    SG_WILDCARD_SLICE: { type: 'SG_WILDCARD_SLICE', category: 'body', spec: 'Tall,-Short', kind: 'sg' },
    SG_REMOVE_WILDCARD: { type: 'SG_REMOVE_WILDCARD', category: 'body', spec: '' },
    SG_REORDER_STYLES: { type: 'SG_REORDER_STYLES', styleIds: ['data/a.csv\0A', 'imports/b.csv\0B'] },
    SG_REORDER_WILDCARDS: {
      type: 'SG_REORDER_WILDCARDS',
      categories: [{ category: 'body', spec: '', kind: 'sgd' }],
    },
    SG_SOURCE_CHANGE: { type: 'SG_SOURCE_CHANGE', source: null },
    SG_STYLE_RENAMED: { type: 'SG_STYLE_RENAMED', old_name: 'A', new_name: 'B', source_file: 'data/a.csv' },
  }

  it('the allowlist and the valid samples cover the same types', () => {
    expect([...FRAME_MESSAGE_TYPES].sort()).toEqual(Object.keys(valid).sort())
  })

  it.each(Object.entries(valid))('accepts a valid %s and keeps its fields', (_type, msg) => {
    expect(parseFrameMessage(msg)).toEqual(msg)
  })

  it('drops extra fields; SG_REFRESH defaults quiet_vanished to false', () => {
    expect(parseFrameMessage({ type: 'SG_CLEAR_ALL', extra: 1 })).toEqual({ type: 'SG_CLEAR_ALL' })
    expect(parseFrameMessage({ type: 'SG_REFRESH' })).toEqual({ type: 'SG_REFRESH', quiet_vanished: false })
    expect(parseFrameMessage({ type: 'SG_UNAPPLY', styleId: 'A' })).toEqual({
      type: 'SG_UNAPPLY',
      styleId: 'A',
      source_file: undefined,
    })
  })

  it.each([
    null,
    'SG_READY',
    [],
    { type: 42 },
    { type: 'READY' },
    { type: 'SG_UNKNOWN' },
    { type: 'SG_GENERATE_PREVIEW', styleId: 'A', source: 'data/a.csv' },
    { type: 'SG_GENERATE_CATEGORY_PREVIEWS', category: 'body', missingCount: 0 },
    { type: 'SG_BATCH_CANCEL' },
    { type: 'SG_BATCH_SKIP' },
    { type: 'SG_SET_FULLSCREEN', fullscreen: true },
    { type: 'SG_REFRESH', quiet_vanished: 'yes' },
    { type: 'SG_APPLY', styleId: '', prompt: 'p', neg: '', source_file: '' },
    { type: 'SG_APPLY', styleId: 'A', prompt: 1, neg: '', source_file: '' },
    { type: 'SG_APPLY', styleId: 'A', prompt: 'p', neg: '' },
    { type: 'SG_UNAPPLY', styleId: 'A', source_file: 3 },
    { type: 'SG_UPLOAD_PREVIEW', styleId: 'A' },
    { type: 'SG_WILDCARD_CATEGORY', category: '' },
    { type: 'SG_WILDCARD_CATEGORY', category: 'body', kind: 'deck' },
    { type: 'SG_WILDCARD_SLICE', category: 'body' },
    { type: 'SG_REMOVE_WILDCARD', category: 'body', spec: 1 },
    { type: 'SG_REORDER_STYLES', styleIds: 'A' },
    { type: 'SG_REORDER_STYLES', styleIds: ['A', 2] },
    { type: 'SG_REORDER_WILDCARDS', categories: {} },
    { type: 'SG_SOURCE_CHANGE' },
    { type: 'SG_SOURCE_CHANGE', source: 5 },
    { type: 'SG_STYLE_RENAMED', old_name: 'A', new_name: '', source_file: 'data/a.csv' },
    { type: 'SG_STYLE_RENAMED', old_name: 'A', new_name: 'B' },
    { type: 'SG_STYLE_RENAMED', source: 'data/a.csv', old_name: 'A', new_name: 'B' },
  ])('rejects %j', (data) => {
    expect(parseFrameMessage(data)).toBeNull()
  })
})

// The host's handling of these messages is covered against the real
// style_grid.js in hostBehavior.test.ts.
describe('reorder payloads (WebUI tray)', () => {
  it('SG_REORDER_STYLES carries styleRowKey strings', () => {
    const msg = parseFrameMessage({ type: 'SG_REORDER_STYLES', styleIds: [ledgerKey('A', 'data/a.csv')] })!
    expect(msg.styleIds).toEqual(['data/a.csv\0A'])
  })

  it('SG_REORDER_WILDCARDS carries {category, spec, kind} refs', () => {
    const categories = [
      { category: 'body', spec: 'Tall', kind: 'sgd' },
      { category: 'hair', spec: '', kind: 'sg' },
    ]
    expect(parseFrameMessage({ type: 'SG_REORDER_WILDCARDS', categories })).toEqual({
      type: 'SG_REORDER_WILDCARDS',
      categories,
    })
  })
})

describe('clearNodePrompts (SG_CLEAR_ALL)', () => {
  it('empties both prompt widgets entirely, the ledger, wildcards and the selection', () => {
    const node = makeNode(1, 'my own words, masterpiece, {sg:body}, tall', 'blurry, lowres')
    const ledgers = new Map<FakeNode, Map<string, Entry>>([[node, ledgerOf(entry('Tall', 'data/a.csv', 'tall'))]])
    const synced: FakeNode[] = []
    const posted: unknown[] = []
    const done = clearNodePrompts(node, {
      setLedger: (n: FakeNode, l: Map<string, Entry>) => ledgers.set(n, l),
      syncWildcards: (n: FakeNode) => synced.push(n),
      post: (m: unknown) => posted.push(m),
    })
    expect(done).toBe(true)
    expect(widget(node, 'text')).toBe('')
    expect(widget(node, 'negative_text')).toBe('')
    expect(widget(node, 'active_source')).toBe('')
    expect(ledgers.get(node)).toEqual(new Map())
    expect(synced).toEqual([node])
    expect(posted).toEqual([{ type: 'SG_CLEAR_SELECTION' }])
    expect(node.graph.setDirtyCanvas).toHaveBeenCalledWith(true, true)
  })

  it('no current node: nothing happens, nothing throws', () => {
    const deps = { setLedger: vi.fn(), syncWildcards: vi.fn(), post: vi.fn() }
    expect(clearNodePrompts(null, deps)).toBe(false)
    expect(deps.setLedger).not.toHaveBeenCalled()
    expect(deps.post).not.toHaveBeenCalled()
  })
})

describe('renameLedgerEntries (SG_STYLE_RENAMED)', () => {
  it('renames only (source_file, old_name) across nodes; same name elsewhere stays', () => {
    const n1 = makeNode(1, 'tall, red hair')
    const n2 = makeNode(2, 'tall')
    const n3 = makeNode(3, 'short')
    const ledgers = new Map<FakeNode, Map<string, Entry>>([
      [n1, ledgerOf(entry('Tall', 'data/a.csv', 'tall'), entry('Red', 'data/a.csv', 'red hair'))],
      [n2, ledgerOf(entry('Tall', 'imports/b.csv', 'tall'))],
      [n3, ledgerOf(entry('Short', 'data/a.csv', 'short'))],
    ])
    const changed = renameLedgerEntries(
      [n1, n2, n3],
      { old_name: 'Tall', new_name: 'Huge', source_file: 'data/a.csv' },
      {
        getLedger: (n: FakeNode) => ledgers.get(n),
        setLedger: (n: FakeNode, l: Map<string, Entry>) => ledgers.set(n, l),
      },
    )
    expect(changed).toEqual([n1])
    expect([...ledgers.get(n1)!.entries()]).toEqual([
      ['data/a.csv\0Huge', entry('Huge', 'data/a.csv', 'tall')],
      ['data/a.csv\0Red', entry('Red', 'data/a.csv', 'red hair')],
    ])
    expect([...ledgers.get(n2)!.keys()]).toEqual(['imports/b.csv\0Tall'])
    expect([...ledgers.get(n3)!.keys()]).toEqual(['data/a.csv\0Short'])
    // Widget text holds the style's tags, not its name: unchanged.
    expect(widget(n1, 'text')).toBe('tall, red hair')
    expect(widget(n2, 'text')).toBe('tall')
    expect(n1.graph.setDirtyCanvas).toHaveBeenCalled()
    expect(n2.graph.setDirtyCanvas).not.toHaveBeenCalled()
  })

  it('legacy nodes without a ledger are skipped', () => {
    const n = makeNode(1, 'tall')
    const setLedger = vi.fn()
    expect(
      renameLedgerEntries([n], { old_name: 'Tall', new_name: 'Huge', source_file: 'data/a.csv' }, {
        getLedger: () => undefined,
        setLedger,
      }),
    ).toEqual([])
    expect(setLedger).not.toHaveBeenCalled()
  })
})

describe('refreshCatalog (SG_REFRESH)', () => {
  const catalog = [
    { name: 'Tall', source_file: 'data/a.csv', prompt: 'tall' },
    { name: 'Gone', source_file: 'imports/b.csv', prompt: 'other' },
  ]

  function setup(opts: { quiet: boolean; styles: typeof catalog }) {
    const node = makeNode(1, 'tall, vanished tag, own text')
    const ledger = ledgerOf(
      entry('Tall', 'data/a.csv', 'tall'),
      entry('Gone', 'data/a.csv', 'vanished tag'),
      entry('NoSource', '', 'own text'),
    )
    const posted: unknown[] = []
    const toasts: string[] = []
    let cache: unknown[] = []
    const deps = {
      fetchStyles: async () => opts.styles,
      setCatalog: (s: unknown[]) => {
        cache = s
      },
      post: (m: unknown) => posted.push(m),
      currentNode: () => node,
      getLedger: () => ledger,
      // Stand-in for unapplyStyleFromNode: strip the recorded tags, drop the entry.
      unapply: (n: FakeNode, e: Entry) => {
        const w = n.widgets.find((x) => x.name === 'text')!
        w.value = w.value
          .split(', ')
          .filter((t) => t !== e.prompt)
          .join(', ')
        ledger.delete(ledgerKey(e.name, e.source_file))
      },
      syncWildcards: vi.fn(),
      toast: (m: string) => toasts.push(m),
    }
    const run = refreshCatalog({ quiet_vanished: opts.quiet }, deps)
    return { node, ledger, posted, toasts, run, cache: () => cache }
  }

  it('posts SG_STYLES_UPDATE (WebUI shape), drops the vanished entry and toasts', async () => {
    const s = setup({ quiet: false, styles: catalog })
    const result = await s.run
    expect(s.posted).toEqual([{ type: 'SG_STYLES_UPDATE', styles: catalog }])
    expect(s.cache()).toEqual(catalog)
    expect(result.vanished).toEqual(['Gone'])
    expect([...s.ledger.keys()]).toEqual(['data/a.csv\0Tall', '\0NoSource'])
    expect(widget(s.node, 'text')).toBe('tall, own text')
    expect(s.toasts).toEqual(['Style "Gone" is no longer in the library; its text was removed from the prompt.'])
  })

  it('quiet_vanished: same cleanup, no toast', async () => {
    const s = setup({ quiet: true, styles: catalog })
    await s.run
    expect([...s.ledger.keys()]).toEqual(['data/a.csv\0Tall', '\0NoSource'])
    expect(s.toasts).toEqual([])
  })

  it('nothing vanished: no cleanup, no toast', async () => {
    const both = [...catalog, { name: 'Gone', source_file: 'data/a.csv', prompt: 'vanished tag' }]
    const s = setup({ quiet: false, styles: both })
    const result = await s.run
    expect(result.vanished).toEqual([])
    expect(s.ledger.size).toBe(3)
    expect(s.toasts).toEqual([])
  })

  it('toast text for several styles', () => {
    expect(vanishedToastMessage(['A', 'B'])).toBe(
      '2 styles are no longer in the library; their text was removed from the prompt.',
    )
  })
})

describe('uploadPreview (SG_UPLOAD_PREVIEW)', () => {
  const msg = { styleId: 'Tall', source: 'data/a.csv' }

  it('posts the image under (name, source), then SG_THUMB_DONE', async () => {
    const posted: unknown[] = []
    const postJson = vi.fn(async () => ({ ok: true }))
    const ok = await uploadPreview(msg, {
      pickImageDataUrl: async () => 'data:image/png;base64,AAAA',
      postJson,
      post: (m: unknown) => posted.push(m),
      now: () => 99,
    })
    expect(ok).toBe(true)
    expect(postJson).toHaveBeenCalledWith('/style_grid/thumbnail/upload', {
      name: 'Tall',
      image: 'data:image/png;base64,AAAA',
      source: 'data/a.csv',
    })
    expect(posted).toEqual([{ type: 'SG_THUMB_DONE', styleId: 'Tall', version: 99, source_file: 'data/a.csv' }])
  })

  it('cancelled picker does nothing; server or network failure toasts', async () => {
    const posted: unknown[] = []
    const base = { post: (m: unknown) => posted.push(m), now: () => 1 }
    const postJson = vi.fn()
    expect(await uploadPreview(msg, { ...base, pickImageDataUrl: async () => null, postJson })).toBe(false)
    expect(postJson).not.toHaveBeenCalled()
    await uploadPreview(msg, {
      ...base,
      pickImageDataUrl: async () => 'x',
      postJson: async () => ({ error: 'Image too large (max 10MB)' }),
    })
    await uploadPreview(msg, {
      ...base,
      pickImageDataUrl: async () => 'x',
      postJson: async () => {
        throw new Error('offline')
      },
    })
    expect(posted).toEqual([
      { type: 'SG_TOAST', message: 'Upload failed: Image too large (max 10MB)', variant: 'error' },
      { type: 'SG_TOAST', message: 'Upload failed', variant: 'error' },
    ])
  })
})
