/** @vitest-environment jsdom */
/**
 * Extension host: the chip row wired into the Style Grid node — node height
 * arithmetic (web/js/node_chips.js), the widget in web/js/style_grid.js, and
 * proof that the non-serialized chip widget leaves widgets_values unchanged.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { reorderLedgerEntries } from '../../../web/js/host_actions.js'
import { chipRowsHeight, createChipRow, nextNodeHeight } from '../../../web/js/node_chips.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const HOST_SRC = fs.readFileSync(path.resolve(HERE, '../../../web/js/style_grid.js'), 'utf8')

/** Body of a top-level function in style_grid.js (up to the next top-level declaration). */
function fnBody(name: string): string {
  const start = HOST_SRC.indexOf(`function ${name}(`)
  expect(start, `function ${name} in style_grid.js`).toBeGreaterThanOrEqual(0)
  const rest = HOST_SRC.slice(start + 1)
  const end = rest.search(/\n(?:async )?function |\nconst |\nlet |\napp\.registerExtension/)
  return HOST_SRC.slice(start, end < 0 ? undefined : start + 1 + end)
}

describe('nextNodeHeight', () => {
  it('same row height → null (no setSize)', () => {
    expect(nextNodeHeight({ currentHeight: 300, minHeight: 200, prevRowsHeight: 32, newRowsHeight: 32 })).toBeNull()
    expect(nextNodeHeight({ currentHeight: 300, minHeight: 200, prevRowsHeight: 0, newRowsHeight: 0 })).toBeNull()
  })

  it('a taller row adds the difference, at least the minimum', () => {
    expect(nextNodeHeight({ currentHeight: 300, minHeight: 280, prevRowsHeight: 0, newRowsHeight: 32 })).toBe(332)
    expect(nextNodeHeight({ currentHeight: 300, minHeight: 360, prevRowsHeight: 32, newRowsHeight: 56 })).toBe(360)
  })

  it('shrink keeps the height the user added by resizing', () => {
    // Minimum 300 with one row; the user stretched the node to 500.
    expect(nextNodeHeight({ currentHeight: 500, minHeight: 268, prevRowsHeight: 32, newRowsHeight: 0 })).toBe(468)
  })

  it('shrink never goes below the minimum', () => {
    expect(nextNodeHeight({ currentHeight: 300, minHeight: 290, prevRowsHeight: 56, newRowsHeight: 0 })).toBe(290)
  })

  it('fit (load / new catalog): only grows to the minimum, never by the difference', () => {
    expect(nextNodeHeight({ currentHeight: 300, minHeight: 332, prevRowsHeight: 0, newRowsHeight: 32, fit: true })).toBe(332)
    expect(nextNodeHeight({ currentHeight: 400, minHeight: 332, prevRowsHeight: 0, newRowsHeight: 32, fit: true })).toBeNull()
  })
})

describe('reorderLedgerEntries (SG_REORDER_STYLES → node chip order)', () => {
  const entry = (source_file: string, name: string) => ({ name, source_file, prompt: name, negative_prompt: '' })
  const ledgerOf = (...es: ReturnType<typeof entry>[]) => new Map(es.map((e) => [`${e.source_file}\0${e.name}`, e]))
  const anklet = entry('data/a.csv', 'ACC_Anklet')
  const bangles = entry('data/a.csv', 'ACC_Bangles_Stacked')
  const charm = entry('data/a.csv', 'ACC_Bracelet_Charm')
  const keys = (m: Map<string, unknown>) => [...m.keys()]

  it('follows the tray order given as styleRowKeys', () => {
    const ledger = ledgerOf(anklet, bangles, charm)
    const next = reorderLedgerEntries(ledger, ['data/a.csv\0ACC_Bangles_Stacked', 'data/a.csv\0ACC_Anklet', 'data/a.csv\0ACC_Bracelet_Charm'])
    expect(keys(next)).toEqual(['data/a.csv\0ACC_Bangles_Stacked', 'data/a.csv\0ACC_Anklet', 'data/a.csv\0ACC_Bracelet_Charm'])
    expect(keys(ledger)).toEqual(['data/a.csv\0ACC_Anklet', 'data/a.csv\0ACC_Bangles_Stacked', 'data/a.csv\0ACC_Bracelet_Charm'])
  })

  it('entries the message does not name keep their order after the named ones; unknown ids are ignored', () => {
    const next = reorderLedgerEntries(ledgerOf(anklet, bangles, charm), ['data/a.csv\0ACC_Bracelet_Charm', 'data/x.csv\0Gone'])
    expect(keys(next)).toEqual(['data/a.csv\0ACC_Bracelet_Charm', 'data/a.csv\0ACC_Anklet', 'data/a.csv\0ACC_Bangles_Stacked'])
  })

  it('same name in two packs: each key moves on its own; a bare name only when it is unique', () => {
    const otherAnklet = entry('imports/b.csv', 'ACC_Anklet')
    const ledger = ledgerOf(anklet, otherAnklet, charm)
    expect(keys(reorderLedgerEntries(ledger, ['imports/b.csv\0ACC_Anklet']))[0]).toBe('imports/b.csv\0ACC_Anklet')
    expect(keys(reorderLedgerEntries(ledger, ['ACC_Anklet']))).toEqual(keys(ledger))
    expect(keys(reorderLedgerEntries(ledger, ['ACC_Bracelet_Charm']))[0]).toBe('data/a.csv\0ACC_Bracelet_Charm')
  })
})

describe('chipRowsHeight', () => {
  it('0 rows → 0; 20px chips, 4px gap, 2px padding, margin on both sides', () => {
    expect(chipRowsHeight(0, 4)).toBe(0)
    expect(chipRowsHeight(1, 4)).toBe(32)
    expect(chipRowsHeight(2, 4)).toBe(56)
  })
})

describe('chip row CSS', () => {
  it('hidden overflow chips stay hidden although .sg-chip sets display', () => {
    createChipRow({ doc: document, onOpen: () => {}, onRemoveStyle: () => {}, onRemoveWildcard: () => {} }).destroy()
    const css = document.getElementById('sg-node-chips-style')?.textContent || ''
    expect(css).toContain('.sg-chips [hidden]{display:none!important}')
  })
})

describe('the sg_chips widget in style_grid.js', () => {
  const addChips = fnBody('addNodeChips')

  it('is a DOM widget with both serialize flags off, only when addDOMWidget exists', () => {
    expect(addChips).toMatch(/if \(typeof node\.addDOMWidget !== "function"\) return;/)
    expect(addChips).toMatch(/node\.addDOMWidget\(CHIP_WIDGET, "sg-chips", state\.row\.el, \{\s*serialize: false,\s*hideOnZoom: true,/)
    expect(addChips).toContain('widget.serialize = false;')
    expect(addChips).toContain('getMinHeight: () => state.height,')
    expect(addChips).toContain('getMaxHeight: () => state.height,')
    expect(addChips).toContain('widget.hidden = true;')
    expect(HOST_SRC).toContain('const CHIP_WIDGET = "sg_chips";')
  })

  it('is added before the Browse Styles button, whose handler still toggles', () => {
    const created = HOST_SRC.slice(HOST_SRC.indexOf('async nodeCreated(node) {'))
    const chips = created.indexOf('addNodeChips(node);')
    const button = created.indexOf('node.addWidget("button", "Browse Styles", null, () => openStyleBrowser(node));')
    expect(chips).toBeGreaterThan(0)
    expect(button).toBeGreaterThan(chips)
    expect(fnBody('openStyleBrowser')).toMatch(
      /if \(overlay && overlay\.style\.display === "block" && currentNode === node\) \{\s*closeStyleBrowser\(\);/,
    )
  })

  it('chip body / +N never closes the panel', () => {
    const show = fnBody('showStyleBrowserFor')
    expect(show).not.toContain('closeStyleBrowser')
    expect(show).toContain('openStyleBrowser(node);')
    expect(addChips).toContain('onOpen: () => showStyleBrowserFor(node),')
  })

  it('✕ reuses the SG_UNAPPLY and SG_REMOVE_WILDCARD paths, then syncs the panel and records an undo step', () => {
    expect(HOST_SRC).toMatch(/if \(msg\.type === "SG_UNAPPLY" && currentNode\) \{\s*unapplyFromMessage\(currentNode, msg, postInfoToast\);/)
    expect(HOST_SRC).toMatch(/if \(msg\.type === "SG_REMOVE_WILDCARD" && currentNode\) \{\s*removeWildcardCategory\(currentNode, msg\.category, msg\.spec \|\| "", msg\.kind\);/)
    const removeStyle = fnBody('removeStyleChip')
    expect(removeStyle).toMatch(/unapplyFromMessage\(\s*node,\s*\{ type: "SG_UNAPPLY", styleId: name, source_file \},/)
    expect(removeStyle).toMatch(/syncPanelForNode\(node\);\s*captureUndoStep\(\);/)
    const removeWildcard = fnBody('removeWildcardChip')
    expect(removeWildcard).toMatch(/removeWildcardCategory\(node, category, spec \|\| "", kind\);\s*syncPanelForNode\(node\);\s*captureUndoStep\(\);/)
    expect(fnBody('captureUndoStep')).toContain('tracker.captureCanvasState()')
  })

  it('the panel sync after ✕ is gated to the panel node with the panel open', () => {
    expect(fnBody('syncPanelForNode')).toMatch(
      /if \(!shouldSyncPanel\(node, currentNode\) \|\| !isPanelOpen\(\)\) return;\s*postToIframe\(\{ type: "SG_CLEAR_SELECTION" \}\);\s*postAppliedStyles\(node\);\s*syncWildcards\(node\);/,
    )
  })

  it('legacy chips read the catalog without writing the ledger', () => {
    const entries = fnBody('chipLedgerEntries')
    expect(entries).not.toMatch(/appliedByNode\.set|legacyShown\.set|ensureLedger/)
    expect(fnBody('legacyPresentStyles')).not.toMatch(/appliedByNode\.set|legacyShown\.set|ensureLedger/)
  })

  it('every sync point refreshes the chips', () => {
    for (const fn of [
      'applyStyleToNode',
      'unapplyStyleFromNode',
      'insertWildcardCategory',
      'removeWildcardCategory',
      'reorderWildcardCategories',
      'reorderStylesInNode',
      'rehydrate',
      'refreshFromServer',
      'setStylesCache',
    ]) {
      expect(fnBody(fn), fn).toContain('refreshNodeChips(')
    }
    expect(HOST_SRC).toMatch(/clearNodePrompts\(currentNode, \{[\s\S]{0,200}\}\);\s*if \(currentNode\) refreshNodeChips\(currentNode\);/)
    expect(HOST_SRC).toMatch(/refreshFromServer\(false\);[\s\S]{0,120}for \(const n of renamed\) refreshNodeChips\(n\);/)
    expect(HOST_SRC).toMatch(/node\.onConfigure = function \(o\) \{[\s\S]{0,600}refreshNodeChips\(this, \{ fit: true \}\);\s*\};/)
    expect(HOST_SRC).toMatch(/loadedGraphNode\(node\) \{[\s\S]{0,600}refreshNodeChips\(node, \{ fit: true \}\);/)
    expect(fnBody('hookChipInputs')).toMatch(/addEventListener\("input", onInput\)/)
    expect(HOST_SRC).toContain('const CHIP_INPUT_DEBOUNCE_MS = 150;')
  })

  it('node removal destroys the row and clears the timers', () => {
    const destroy = fnBody('destroyNodeChips')
    expect(destroy).toContain('clearTimeout(state.timer);')
    expect(destroy).toContain('cancelAnimationFrame(state.frame)')
    expect(destroy).toContain('state.row.destroy();')
    expect(addChips).toMatch(/node\.onRemoved = function[\s\S]{0,160}destroyNodeChips\(this\);/)
  })
})

/**
 * The ComfyUI frontend 1.58.5 rule (serialiseWidgetValues in the bundled
 * frontend): widgets with widget.serialize === false are skipped, values are
 * pushed in order, and widgets_values_named holds them by name.
 */
type W = { name: string; value: unknown; serialize?: boolean; options?: { serialize?: boolean } }
function serialiseWidgetValues(widgets: W[]) {
  const widgets_values: unknown[] = []
  const widgets_values_named: Record<string, unknown> = {}
  for (const w of widgets) {
    if (w.serialize === false) continue
    widgets_values.push(w.value ?? null)
    widgets_values_named[w.name] = w.value ?? null
  }
  return { widgets_values, widgets_values_named }
}
/** 1.58.5 restore: positional slots are counted over serializable widgets only. */
function restoreWidgetValues(widgets: W[], values: unknown[]) {
  let slot = 0
  for (const w of widgets) {
    if (w.serialize === false) continue
    if (slot < values.length) w.value = values[slot]
    slot++
  }
}

describe('widgets_values with the sg_chips widget', () => {
  const nodeWidgets = (chips?: W): W[] => [
    { name: 'text', value: 'tall, {sg:hair}' },
    { name: 'negative_text', value: 'short' },
    { name: 'active_source', value: '' },
    { name: 'deck_seed', value: 7 },
    { name: 'deck_index', value: 2 },
    { name: 'seed', value: 42 },
    { name: 'control_after_generate', value: 'randomize' },
    ...(chips ? [chips] : []),
    { name: 'Browse Styles', value: null },
  ]
  const chipsWidget = (): W => ({ name: 'sg_chips', value: undefined, serialize: false, options: { serialize: false } })

  it('identical widgets_values and widgets_values_named with and without the chip widget', () => {
    expect(serialiseWidgetValues(nodeWidgets(chipsWidget()))).toEqual(serialiseWidgetValues(nodeWidgets()))
  })

  it('options.serialize alone is not enough: the slot shifts (why both flags are set)', () => {
    const optionsOnly: W = { name: 'sg_chips', value: undefined, options: { serialize: false } }
    expect(serialiseWidgetValues(nodeWidgets(optionsOnly)).widgets_values)
      .not.toEqual(serialiseWidgetValues(nodeWidgets()).widgets_values)
  })

  it('a workflow saved without chips restores onto the same widgets', () => {
    const saved = serialiseWidgetValues(nodeWidgets()).widgets_values
    const fresh = nodeWidgets(chipsWidget()).map((w) => ({ ...w, value: w.serialize === false ? undefined : 'default' }))
    restoreWidgetValues(fresh, saved)
    expect(Object.fromEntries(fresh.map((w) => [w.name, w.value]))).toEqual({
      text: 'tall, {sg:hair}',
      negative_text: 'short',
      active_source: '',
      deck_seed: 7,
      deck_index: 2,
      seed: 42,
      control_after_generate: 'randomize',
      sg_chips: undefined,
      'Browse Styles': null,
    })
  })
})
