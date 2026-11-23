/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isTrustedHostEvent,
  onHostMessage,
  parseHostMessage,
  sendToHost,
} from './bridge'
// The ComfyUI host's guard for iframe -> host messages (web/js/style_grid.js runs it).
import { parseFrameMessage } from '../../web/js/frame_messages.js'

const bridgeOrigin = () => window.location.origin

describe('parseHostMessage', () => {
  it('accepts valid SG_THEME', () => {
    expect(parseHostMessage({ type: 'SG_THEME', mode: 'dark' })).toEqual({
      type: 'SG_THEME',
      mode: 'dark',
    })
  })

  it('ignores unknown types', () => {
    expect(parseHostMessage({ type: 'SG_NOT_A_REAL_TYPE' })).toBeNull()
    expect(parseHostMessage({ type: 'OTHER' })).toBeNull()
  })

  it('ignores malformed payloads', () => {
    expect(parseHostMessage(null)).toBeNull()
    expect(parseHostMessage({ type: 'SG_THEME', mode: 'neon' })).toBeNull()
    expect(parseHostMessage({ type: 'SG_TOAST', message: 1, variant: 'info' })).toBeNull()
    expect(
      parseHostMessage({ type: 'SG_THUMB_DONE', styleId: 'x', version: '1', source_file: '' }),
    ).toBeNull()
    expect(parseHostMessage({ type: 'SG_INIT', tab: 'other', styles: [] })).toBeNull()
    expect(parseHostMessage({ type: 'SG_DECK_STATE', seed: '1', index: 0 })).toBeNull()
  })

  it('SG_INIT without a tab (ComfyUI host) is accepted; a present tab must be valid', () => {
    expect(parseHostMessage({ type: 'SG_INIT', styles: [] })).toEqual({ type: 'SG_INIT', styles: [] })
    expect(parseHostMessage({ type: 'SG_INIT', tab: 'img2img', styles: [] })).toEqual({
      type: 'SG_INIT',
      tab: 'img2img',
      styles: [],
    })
    expect(parseHostMessage({ type: 'SG_INIT', tab: null, styles: [] })).toBeNull()
  })

  it('SG_DECK_STATE carries the node deck seed and index', () => {
    expect(parseHostMessage({ type: 'SG_DECK_STATE', seed: 7, index: 2, extra: 1 })).toEqual({
      type: 'SG_DECK_STATE',
      seed: 7,
      index: 2,
    })
  })
})

describe('fullscreen and preview generation are not host messages here', () => {
  it('the host guard rejects SG_SET_FULLSCREEN and generation (ComfyUI: frame-element fullscreen, upload only)', () => {
    for (const msg of [
      { type: 'SG_SET_FULLSCREEN', fullscreen: true },
      { type: 'SG_GENERATE_PREVIEW', styleId: 'A', source: 'data/a.csv' },
      { type: 'SG_GENERATE_CATEGORY_PREVIEWS', category: 'BODY', missingCount: 0 },
      { type: 'SG_BATCH_CANCEL' },
      { type: 'SG_BATCH_SKIP' },
    ]) {
      expect(parseFrameMessage(msg)).toBeNull()
    }
  })

  it('the deck requests pass the host guard', () => {
    expect(parseFrameMessage({ type: 'SG_DECK_RESTART' })).toEqual({ type: 'SG_DECK_RESTART' })
    expect(parseFrameMessage({ type: 'SG_DECK_NEW' })).toEqual({ type: 'SG_DECK_NEW' })
  })
})

describe('parseFrameMessage (host)', () => {
  it('accepts valid SG_READY / SG_APPLY', () => {
    expect(parseFrameMessage({ type: 'SG_READY' })).toEqual({ type: 'SG_READY' })
    expect(
      parseFrameMessage({
        type: 'SG_APPLY',
        styleId: 'A',
        prompt: 'p',
        neg: 'n',
        source_file: 'f.csv',
      }),
    ).toMatchObject({ type: 'SG_APPLY', styleId: 'A' })
  })

  it('ignores unknown and malformed', () => {
    expect(parseFrameMessage({ type: 'SG_NOPE' })).toBeNull()
    expect(parseFrameMessage({ type: 'SG_APPLY', styleId: 'A' })).toBeNull()
    expect(parseFrameMessage({ type: 'SG_SOURCE_CHANGE', source: 1 })).toBeNull()
  })

  // The iframe owns these dialogs; the host no longer accepts the requests.
  it.each([
    { type: 'SG_NEW_STYLE', sourceFile: 'styles/a.csv' },
    { type: 'SG_NEW_STYLE' },
    { type: 'SG_EDIT_STYLE', styleId: 'A', source_file: 'styles/a.csv' },
    { type: 'SG_MOVE_TO_CATEGORY', styleId: 'A', source_file: 'styles/a.csv' },
    { type: 'SG_DELETE_STYLE', styleId: 'A', source_file: 'styles/a.csv' },
    { type: 'SG_DUPLICATE_STYLE', styleId: 'A', source_file: 'styles/a.csv' },
    { type: 'SG_IMPORT_EXPORT' },
    { type: 'SG_BACKUP' },
  ])('rejects the retired $type', (msg) => {
    expect(parseFrameMessage(msg)).toBeNull()
  })
})

describe('host↔iframe trust guards', () => {
  /** jsdom sets window.parent === window; stub a distinct host parent for source checks. */
  const hostParent = { postMessage: vi.fn() } as unknown as Window

  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: window,
    })
  })

  function stubHostParent(): void {
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: hostParent,
    })
  }

  it('isTrustedHostEvent rejects foreign origin and wrong source', () => {
    stubHostParent()
    expect(
      isTrustedHostEvent({
        origin: 'https://evil.example',
        source: hostParent,
        data: { type: 'SG_CLOSE' },
      } as unknown as MessageEvent),
    ).toBe(false)
    expect(
      isTrustedHostEvent({
        origin: bridgeOrigin(),
        source: window,
        data: { type: 'SG_CLOSE' },
      } as unknown as MessageEvent),
    ).toBe(false)
    expect(
      isTrustedHostEvent({
        origin: bridgeOrigin(),
        source: hostParent,
        data: { type: 'SG_CLOSE' },
      } as unknown as MessageEvent),
    ).toBe(true)
  })

  it('onHostMessage ignores foreign-origin, wrong-source, malformed; handles valid', () => {
    stubHostParent()
    let listener: ((e: MessageEvent) => void) | undefined
    const addSpy = vi.spyOn(window, 'addEventListener').mockImplementation((type, fn) => {
      if (type === 'message') {
        listener = fn as (e: MessageEvent) => void
      }
    })
    const removeSpy = vi.spyOn(window, 'removeEventListener').mockImplementation(() => {})

    const handled: string[] = []
    const unsub = onHostMessage((msg) => {
      handled.push(msg.type)
    })
    expect(listener).toBeTypeOf('function')

    const fire = (partial: Pick<MessageEvent, 'origin' | 'source' | 'data'>) => {
      listener!(partial as unknown as MessageEvent)
    }

    fire({
      origin: 'https://evil.example',
      source: hostParent,
      data: { type: 'SG_CLOSE' },
    })
    fire({
      origin: window.location.origin,
      source: window,
      data: { type: 'SG_CLOSE' },
    })
    fire({
      origin: window.location.origin,
      source: hostParent,
      data: { type: 'SG_THEME', mode: 'neon' },
    })
    fire({
      origin: window.location.origin,
      source: hostParent,
      data: { type: 'SG_CLOSE' },
    })

    expect(handled).toEqual(['SG_CLOSE'])
    unsub()
    expect(removeSpy).toHaveBeenCalled()
    addSpy.mockRestore()
    removeSpy.mockRestore()
  })

  it('sendToHost uses window.location.origin', () => {
    stubHostParent()
    sendToHost({ type: 'SG_READY' })
    expect(hostParent.postMessage).toHaveBeenCalledWith(
      { type: 'SG_READY' },
      window.location.origin,
    )
  })
})
