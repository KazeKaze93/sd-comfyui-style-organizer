/** @vitest-environment jsdom */
/**
 * Extension host (web/js/node_chips.js): the chip row on the Style Grid node —
 * the model built from the ledger and the prompt text, and the DOM row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chipDisplayName, createChipRow, nodeChipModel } from '../../../web/js/node_chips.js'
import { trayDisplayName } from './trayDisplayName'

type Entry = { name: string; source_file: string; prompt: string; negative_prompt: string }

const tall: Entry = { name: 'BODY_Tall', source_file: 'data/styles.csv', prompt: 'tall, long legs', negative_prompt: 'short' }
const tallB: Entry = { name: 'BODY_Tall', source_file: 'imports/other.csv', prompt: 'very tall', negative_prompt: '' }
const red: Entry = { name: 'HAIR_Red', source_file: 'data/styles.csv', prompt: 'red hair', negative_prompt: '' }

const model = (ledgerEntries: Entry[], text: string, negativeText = '', catalogKeys?: Set<string> | null) =>
  nodeChipModel({ ledgerEntries, text, negativeText, catalogKeys })

describe('nodeChipModel: styles', () => {
  it('keeps present styles in ledger order and drops manually erased ones', () => {
    const m = model([red, tall], 'tall, long legs, red hair', 'short')
    expect(m.styles.map((s) => s.name)).toEqual(['HAIR_Red', 'BODY_Tall'])
    const erased = model([red, tall], 'tall, red hair', 'short')
    expect(erased.styles.map((s) => s.name)).toEqual(['HAIR_Red'])
  })

  it('chip fields: key, name, source_file, label, title, missing', () => {
    expect(model([tall], 'tall, long legs', 'short').styles).toEqual([
      {
        key: 'data/styles.csv\0BODY_Tall',
        name: 'BODY_Tall',
        source_file: 'data/styles.csv',
        label: 'Tall',
        title: 'BODY_Tall — styles.csv',
        missing: false,
      },
    ])
  })

  it('two same-named styles from different packs stay two chips', () => {
    const m = model([tall, tallB], 'tall, long legs, very tall', 'short')
    expect(m.styles.map((s) => s.key)).toEqual(['data/styles.csv\0BODY_Tall', 'imports/other.csv\0BODY_Tall'])
    expect(m.styles.map((s) => s.title)).toEqual(['BODY_Tall — styles.csv', 'BODY_Tall — other.csv'])
  })

  it('does not mutate its input', () => {
    const entries = [tall, red]
    const copy = JSON.parse(JSON.stringify(entries))
    model(entries, '', '', new Set())
    expect(entries).toEqual(copy)
  })

  it('missing: no catalog → never missing; catalog without the key → missing', () => {
    expect(model([tall], 'tall, long legs', 'short', null).styles[0].missing).toBe(false)
    expect(model([tall], 'tall, long legs', 'short', undefined).styles[0].missing).toBe(false)
    expect(model([tall], 'tall, long legs', 'short', new Set(['imports/other.csv\0BODY_Tall'])).styles[0].missing).toBe(true)
    expect(model([tall], 'tall, long legs', 'short', new Set(['data/styles.csv\0BODY_Tall'])).styles[0].missing).toBe(false)
  })
})

describe('chip label = tray label (ui/src/lib/trayDisplayName.ts)', () => {
  const names = [
    'Tall',
    'BODY_Tall',
    'BODY_Tall_Amazon',
    'BODY_FURRY_Wolf',
    'BODY_FURRY_Big_Cat',
    'BODY_FUTA_Muscular',
    'BODY_FUTA_Soft_Curvy',
    '_Leading',
    'Trailing_',
    'A__B',
    'no prefix here',
  ]
  it.each(names)('%s', (name) => {
    expect(chipDisplayName(name)).toBe(trayDisplayName(name))
  })
})

describe('nodeChipModel: wildcards', () => {
  it('sg and sgd, with and without a slice, in token order', () => {
    const m = model([], '{sg:hair}, {sgd:body:1-3}', '{sg:eyes:2,4}')
    expect(m.wildcards).toEqual([
      { key: 'hair\0\0sg', category: 'hair', spec: '', kind: 'sg', label: 'hair' },
      { key: 'body\x001-3\0sgd', category: 'body', spec: '1-3', kind: 'sgd', label: 'body (slice)' },
      { key: 'eyes\x002,4\0sg', category: 'eyes', spec: '2,4', kind: 'sg', label: 'eyes (slice)' },
    ])
  })
})

describe('nodeChipModel: signature', () => {
  it('stable for the same input', () => {
    expect(model([tall, red], 'tall, long legs, red hair', 'short').signature)
      .toBe(model([tall, red], 'tall, long legs, red hair', 'short').signature)
  })

  it('changes on a label, missing flag or order change', () => {
    const base = model([tall, red], 'tall, long legs, red hair', 'short').signature
    const renamed = model([{ ...tall, name: 'BODY_Huge' }, red], 'tall, long legs, red hair', 'short').signature
    const missing = model([tall, red], 'tall, long legs, red hair', 'short', new Set()).signature
    const reordered = model([red, tall], 'tall, long legs, red hair', 'short').signature
    const wildcard = model([tall, red], 'tall, long legs, red hair, {sg:hair}', 'short').signature
    for (const other of [renamed, missing, reordered, wildcard]) expect(other).not.toBe(base)
  })
})

describe('createChipRow', () => {
  let host: HTMLDivElement
  let row: ReturnType<typeof createChipRow>
  const onOpen = vi.fn()
  const onRemoveStyle = vi.fn()
  const onRemoveWildcard = vi.fn()

  const make = (measureRows?: (els: HTMLElement[]) => number[]) => {
    row = createChipRow({ doc: document, onOpen, onRemoveStyle, onRemoveWildcard, measureRows })
    host.appendChild(row.el)
    return row
  }
  const full = () => model([tall, tallB], 'tall, long legs, very tall, {sgd:body:1-3}, {sg:hair}', 'short')
  const buttons = (selector: string) => [...row.el.querySelectorAll<HTMLButtonElement>(selector)]
  const key = (target: Element, k: string) => {
    const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
    target.dispatchEvent(e)
    return e
  }

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    onOpen.mockClear()
    onRemoveStyle.mockClear()
    onRemoveWildcard.mockClear()
  })
  afterEach(() => {
    row?.destroy()
    host.remove()
  })

  it('injects one <style> per document', () => {
    make()
    createChipRow({ doc: document, onOpen, onRemoveStyle, onRemoveWildcard }).destroy()
    expect(document.querySelectorAll('#sg-node-chips-style')).toHaveLength(1)
  })

  it('empty model → rows 0 and no children', () => {
    make()
    expect(row.render(model([], 'plain text'))).toEqual({ rows: 0 })
    expect(row.el.children).toHaveLength(0)
  })

  it('one chip per style and wildcard: body and ✕ buttons, no nested buttons', () => {
    make()
    expect(row.render(full())).toEqual({ rows: 1 })
    expect(buttons('.sg-chip-body').map((b) => b.textContent)).toEqual([
      'Tall',
      'Tall',
      // Deck marker: SVG (no text) + screen-reader text, then the label.
      'Shuffle: each style is used once before any repeats (one step per queue run)body (slice)',
      '\u{1F3B2}hair',
    ])
    expect(row.el.querySelectorAll('button button')).toHaveLength(0)
    expect(buttons('.sg-chip-x').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Remove BODY_Tall',
      'Remove BODY_Tall',
      'Remove wildcard body',
      'Remove wildcard hair',
    ])
    expect(buttons('.sg-chip-body').map((b) => b.title)).toEqual([
      'BODY_Tall — styles.csv',
      'BODY_Tall — other.csv',
      'Shuffle: each style is used once before any repeats (one step per queue run). Slice: 1-3',
      '',
    ])
  })

  it('wildcard chips: deck marker is the inline DeckIcon SVG, dice is the panel emoji', () => {
    make()
    row.render(full())
    const [deck, dice] = [...row.el.querySelectorAll('.sg-chip--wildcard')]
    expect(deck.querySelector('svg.sg-chip-icon mask')).not.toBeNull()
    expect(deck.querySelector('.sg-sr-only')?.textContent).toContain('Shuffle')
    expect(deck.querySelector('.sg-chip-label')?.textContent).toBe('body (slice)')
    expect(dice.querySelector('svg')).toBeNull()
    expect(dice.querySelector('.sg-chip-body')?.textContent).toBe('\u{1F3B2}hair')
  })

  it('a missing style is marked, titled and still removable', () => {
    make()
    row.render(model([tall], 'tall, long legs', 'short', new Set()))
    const chip = row.el.querySelector('.sg-chip')!
    expect(chip.classList.contains('sg-chip--missing')).toBe(true)
    expect(chip.querySelector<HTMLButtonElement>('.sg-chip-body')!.title).toContain('No longer in the library')
    const x = chip.querySelector<HTMLButtonElement>('.sg-chip-x')!
    expect(x.disabled).toBe(false)
    x.click()
    expect(onRemoveStyle).toHaveBeenCalledWith({ source_file: 'data/styles.csv', name: 'BODY_Tall' })
  })

  it('✕ on a style passes its exact (source_file, name); ✕ on a wildcard its (category, spec, kind)', () => {
    make()
    row.render(full())
    const xs = buttons('.sg-chip-x')
    xs[1].click()
    expect(onRemoveStyle).toHaveBeenCalledTimes(1)
    expect(onRemoveStyle).toHaveBeenCalledWith({ source_file: 'imports/other.csv', name: 'BODY_Tall' })
    xs[2].click()
    expect(onRemoveWildcard).toHaveBeenCalledWith({ category: 'body', spec: '1-3', kind: 'sgd' })
    xs[3].click()
    expect(onRemoveWildcard).toHaveBeenLastCalledWith({ category: 'hair', spec: '', kind: 'sg' })
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('a chip body opens the panel', () => {
    make()
    row.render(full())
    buttons('.sg-chip-body')[0].click()
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onRemoveStyle).not.toHaveBeenCalled()
  })

  it('overflow: past two rows chips hide and +N (N recomputed so +N fits on row 2) opens the panel', () => {
    // Three elements per row.
    make((els) => els.map((_, i) => Math.floor(i / 3)))
    const many = model(
      [],
      Array.from({ length: 8 }, (_, i) => `{sg:c${i}}`).join(', '),
    )
    expect(row.render(many)).toEqual({ rows: 2 })
    const chips = [...row.el.querySelectorAll<HTMLElement>('.sg-chip')]
    expect(chips.filter((c) => !c.hidden)).toHaveLength(5)
    const more = row.el.querySelector<HTMLButtonElement>('.sg-chip-more')!
    expect(more.textContent).toBe('+3')
    expect(more.getAttribute('aria-label')).toBe('Show 3 more in Style Grid')
    more.click()
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('no +N when everything fits in two rows', () => {
    make((els) => els.map((_, i) => Math.floor(i / 3)))
    expect(row.render(model([], Array.from({ length: 6 }, (_, i) => `{sg:c${i}}`).join(', ')))).toEqual({ rows: 2 })
    expect(row.el.querySelector('.sg-chip-more')).toBeNull()
    expect([...row.el.querySelectorAll<HTMLElement>('.sg-chip')].every((c) => !c.hidden)).toBe(true)
  })

  it('Delete on a keyboard-focused chip removes it and is swallowed', () => {
    make()
    row.render(full())
    const outer = vi.fn()
    host.addEventListener('keydown', outer)
    key(document.body, 'Tab')
    const body = buttons('.sg-chip-body')[0]
    body.focus()
    const e = key(body, 'Delete')
    expect(onRemoveStyle).toHaveBeenCalledWith({ source_file: 'data/styles.csv', name: 'BODY_Tall' })
    expect(e.defaultPrevented).toBe(true)
    expect(outer).not.toHaveBeenCalled()
    const x = buttons('.sg-chip-x')[3]
    x.focus()
    const e2 = key(x, 'Backspace')
    expect(onRemoveWildcard).toHaveBeenCalledWith({ category: 'hair', spec: '', kind: 'sg' })
    expect(e2.defaultPrevented).toBe(true)
  })

  it('Delete after a pointer click is not intercepted; the clicked button is blurred', () => {
    make()
    row.render(full())
    const outer = vi.fn()
    host.addEventListener('keydown', outer)
    const body = buttons('.sg-chip-body')[0]
    body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    body.focus()
    body.click()
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(document.activeElement).not.toBe(body)
    body.focus()
    const e = key(body, 'Delete')
    expect(onRemoveStyle).not.toHaveBeenCalled()
    expect(e.defaultPrevented).toBe(false)
    expect(outer).toHaveBeenCalledTimes(1)
  })

  it('pointerdown does not leave the row; wheel does', () => {
    make()
    row.render(full())
    const pointer = vi.fn()
    const wheel = vi.fn()
    host.addEventListener('pointerdown', pointer)
    host.addEventListener('wheel', wheel)
    const body = buttons('.sg-chip-body')[0]
    body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    body.dispatchEvent(new Event('wheel', { bubbles: true }))
    expect(pointer).not.toHaveBeenCalled()
    expect(wheel).toHaveBeenCalledTimes(1)
  })

  it('destroy removes the element and its listeners', () => {
    make()
    row.render(full())
    const el = row.el
    const body = el.querySelector<HTMLButtonElement>('.sg-chip-body')!
    row.destroy()
    expect(el.isConnected).toBe(false)
    body.click()
    expect(onOpen).not.toHaveBeenCalled()
    const pointer = vi.fn()
    el.addEventListener('pointerdown', pointer)
    body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(pointer).toHaveBeenCalledTimes(1)
    row = createChipRow({ doc: document, onOpen, onRemoveStyle, onRemoveWildcard })
  })
})
