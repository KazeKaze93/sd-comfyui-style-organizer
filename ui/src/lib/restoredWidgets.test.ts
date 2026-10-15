import { describe, expect, it } from 'vitest'
import { repairRestoredWidgets } from '../../../web/js/restored_widgets.js'

const CONTROL_MODES = ['fixed', 'increment', 'decrement', 'randomize']

type Widget = {
  name: string
  value: unknown
  type?: 'combo'
  options?: { values: string[] }
  linkedWidgets?: Widget[]
}

function intWithControl(name: string, controlName: string, mode: string): Widget[] {
  const control: Widget = { name: controlName, value: mode, type: 'combo', options: { values: CONTROL_MODES } }
  return [{ name, value: 0, linkedWidgets: [control] }, control]
}

// StyleGridNode as ComfyUI frontend 1.55.17 builds it: inputs in INPUT_TYPES order, each control_after_generate
// combo right after its INT (a string option becomes the combo's name), then the Browse Styles button.
function createWidgets(): Widget[] {
  return [
    { name: 'text', value: '' },
    { name: 'negative_text', value: '' },
    { name: 'active_source', value: '' },
    ...intWithControl('deck_seed', 'fixed', 'fixed'),
    ...intWithControl('deck_index', 'increment', 'increment'),
    { name: 'style_negatives', value: false },
    ...intWithControl('seed', 'control_after_generate', 'randomize'),
    { name: 'Browse Styles', value: null },
  ]
}

// Load order of the frontend: restore values, reset null combos to their first value, then loadedGraphNode.
function finishLoad(widgets: Widget[]): unknown[] {
  for (const widget of widgets) {
    if (widget.type === 'combo' && widget.value == null) widget.value = widget.options?.values[0]
  }
  repairRestoredWidgets(widgets)
  return widgets.map((widget) => widget.value)
}

function loadPositional(widgetsValues: unknown[]): unknown[] {
  const widgets = createWidgets()
  widgets.forEach((widget, i) => {
    if (i < widgetsValues.length) widget.value = widgetsValues[i]
  })
  return finishLoad(widgets)
}

function loadNamed(named: Record<string, unknown>): unknown[] {
  const widgets = createWidgets()
  for (const widget of widgets) {
    if (Object.hasOwn(named, widget.name)) widget.value = named[widget.name]
  }
  return finishLoad(widgets)
}

const TEXT = ['{sgd:accessory:Anklet,Armband,Backpack}', 'lowres', 'styles_nsfw_core.csv']

describe('repairRestoredWidgets on workflows saved by older versions', () => {
  it('before the deck inputs: the button null lands on deck_seed', () => {
    expect(loadPositional([...TEXT, null])).toEqual([
      ...TEXT, 0, 'fixed', 0, 'increment', false, 0, 'randomize', null,
    ])
  })

  it('0.0.11, before style_negatives: the button null lands on style_negatives', () => {
    expect(loadPositional([...TEXT, 42, 'fixed', 3, 'increment', null])).toEqual([
      ...TEXT, 42, 'fixed', 3, 'increment', false, 0, 'randomize', null,
    ])
  })

  it('with style_negatives, before seed: the button null lands on seed', () => {
    expect(loadPositional([...TEXT, 42, 'fixed', 3, 'increment', false, null])).toEqual([
      ...TEXT, 42, 'fixed', 3, 'increment', false, 0, 'randomize', null,
    ])
  })

  it('with style_negatives, before seed, restored by name', () => {
    const named = {
      text: TEXT[0], negative_text: TEXT[1], active_source: TEXT[2],
      deck_seed: 42, fixed: 'fixed', deck_index: 3, increment: 'increment', style_negatives: false,
      'Browse Styles': null,
    }
    expect(loadNamed(named)).toEqual([...TEXT, 42, 'fixed', 3, 'increment', false, 0, 'randomize', null])
  })

  it('current layout keeps every value', () => {
    const saved = [...TEXT, 42, 'fixed', 3, 'increment', false, 987654321, 'fixed', null]
    expect(loadPositional(saved)).toEqual(saved)
  })

  it('invalid numbers and control modes fall back to the defaults', () => {
    expect(loadPositional([...TEXT, 42, 'nope', 3, 'increment', false, -5, 'bogus', null])).toEqual([
      ...TEXT, 42, 'fixed', 3, 'increment', false, 0, 'randomize', null,
    ])
  })
})
