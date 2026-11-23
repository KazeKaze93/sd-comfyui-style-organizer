/** @vitest-environment jsdom */
/**
 * PLATFORM.reapplyEditedStyles (ComfyUI): an applied style edited without a
 * rename is taken out of the node text and put back with the new text.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendToHost, type Style } from '../bridge'
import { __resetLayerStackForTests } from '../lib/layerStack'
import { PLATFORM } from '../lib/platform'
import { styleRowKey, useStylesStore } from '../store/stylesStore'
import { StyleEditorDialog } from './StyleEditorDialog'

vi.mock('../bridge', async () => {
  const actual = await vi.importActual<typeof import('../bridge')>('../bridge')
  return { ...actual, sendToHost: vi.fn() }
})

const sendToHostMock = vi.mocked(sendToHost)
const A = 'data/styles.csv'
const subject: Style = {
  name: 'BODY_Tall',
  source_file: A,
  prompt: 'tall',
  negative_prompt: 'short',
  description: '',
  category: 'BODY',
}

describe.runIf(PLATFORM.reapplyEditedStyles)('edit an applied style', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null
  const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]')!
  const field = (label: string) => {
    const l = [...dialog().querySelectorAll('label')].find((x) => x.textContent!.startsWith(label))!
    return document.getElementById(l.htmlFor) as HTMLInputElement & HTMLTextAreaElement
  }
  const save = () => [...dialog().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Save')!
  const setValue = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const click = async (el: HTMLElement) => {
    await act(async () => el.click())
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
  }
  const messages = () => sendToHostMock.mock.calls.map(([m]) => m)

  async function render(applied: boolean) {
    useStylesStore.setState({
      styles: [subject],
      toasts: [],
      selectedStyles: applied ? [subject] : [],
      selectedKeySet: new Set(applied ? [styleRowKey(subject)] : []),
    })
    await act(async () => {
      root!.render(<StyleEditorDialog mode="edit" open style={subject} onClose={() => root?.render(<></>)} />)
    })
  }

  beforeEach(() => {
    __resetLayerStackForTests()
    sendToHostMock.mockClear()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }) as Response))
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    vi.unstubAllGlobals()
    __resetLayerStackForTests()
  })

  it('applied, saved without a rename: UNAPPLY the old text, APPLY the new one, then SG_REFRESH', async () => {
    await render(true)
    await setValue(field('Prompt'), 'very tall')
    await setValue(field('Negative prompt'), 'tiny')
    await click(save())
    expect(messages()).toEqual([
      { type: 'SG_UNAPPLY', styleId: 'BODY_Tall', source_file: A },
      { type: 'SG_APPLY', styleId: 'BODY_Tall', prompt: 'very tall', neg: 'tiny', source_file: A },
      { type: 'SG_REFRESH' },
    ])
  })

  it('not applied: only SG_REFRESH', async () => {
    await render(false)
    await setValue(field('Prompt'), 'very tall')
    await click(save())
    expect(messages()).toEqual([{ type: 'SG_REFRESH' }])
  })

  it('applied and renamed only: SG_STYLE_RENAMED, no reapply (the host moves its ledger entry)', async () => {
    await render(true)
    await setValue(field('Name'), 'Huge')
    await click(save())
    expect(messages()).toEqual([
      { type: 'SG_STYLE_RENAMED', old_name: 'BODY_Tall', new_name: 'BODY_Huge', source_file: A },
    ])
  })

  it('applied, renamed and content changed: SG_STYLE_RENAMED, then UNAPPLY / APPLY under the new name', async () => {
    await render(true)
    await setValue(field('Name'), 'Huge')
    await setValue(field('Negative prompt'), 'tiny')
    await click(save())
    expect(messages()).toEqual([
      { type: 'SG_STYLE_RENAMED', old_name: 'BODY_Tall', new_name: 'BODY_Huge', source_file: A },
      { type: 'SG_UNAPPLY', styleId: 'BODY_Huge', source_file: A },
      { type: 'SG_APPLY', styleId: 'BODY_Huge', prompt: 'tall', neg: 'tiny', source_file: A },
    ])
  })

  it('not applied, renamed and content changed: SG_STYLE_RENAMED only', async () => {
    await render(false)
    await setValue(field('Name'), 'Huge')
    await setValue(field('Prompt'), 'giant')
    await click(save())
    expect(messages()).toEqual([
      { type: 'SG_STYLE_RENAMED', old_name: 'BODY_Tall', new_name: 'BODY_Huge', source_file: A },
    ])
  })
})
