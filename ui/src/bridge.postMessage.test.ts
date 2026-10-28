/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isTrustedHostEvent,
  onHostMessage,
  parseHostMessage,
  sendToHost,
} from './bridge'

describe('parseHostMessage', () => {
  it('accepts each valid host payload', () => {
    expect(parseHostMessage({ type: 'SG_CLEAR_SELECTION' })).toEqual({
      type: 'SG_CLEAR_SELECTION',
    })
    expect(parseHostMessage({ type: 'SG_CLOSE' })).toEqual({ type: 'SG_CLOSE' })
    expect(parseHostMessage({ type: 'SG_INIT', styles: [] })).toEqual({
      type: 'SG_INIT',
      styles: [],
    })
    expect(
      parseHostMessage({ type: 'SG_TOAST', message: 'ok', variant: 'info' }),
    ).toEqual({ type: 'SG_TOAST', message: 'ok', variant: 'info' })
    expect(
      parseHostMessage({
        type: 'SG_STYLE_APPLIED',
        style: { name: 'A' },
      }),
    ).toMatchObject({ type: 'SG_STYLE_APPLIED' })
    expect(
      parseHostMessage({
        type: 'SG_WILDCARDS_ACTIVE',
        categories: [{ category: 'c', spec: '' }],
      }),
    ).toMatchObject({ type: 'SG_WILDCARDS_ACTIVE' })
    expect(parseHostMessage({ type: 'SG_THEME', mode: 'dark' })).toEqual({
      type: 'SG_THEME',
      mode: 'dark',
    })
    expect(
      parseHostMessage({ type: 'SG_DECK_STATE', seed: 1, index: 0 }),
    ).toEqual({ type: 'SG_DECK_STATE', seed: 1, index: 0 })
  })

  it('ignores unknown types', () => {
    expect(parseHostMessage({ type: 'SG_NOT_A_REAL_TYPE' })).toBeNull()
    expect(parseHostMessage({ type: 'OTHER' })).toBeNull()
    expect(
      parseHostMessage({
        type: 'SG_THUMB_DONE',
        styleId: 'x',
        version: 1,
        source_file: '',
      }),
    ).toBeNull()
  })

  it('ignores malformed payloads', () => {
    expect(parseHostMessage(null)).toBeNull()
    expect(parseHostMessage({ type: 'SG_THEME', mode: 'neon' })).toBeNull()
    expect(
      parseHostMessage({ type: 'SG_TOAST', message: 1, variant: 'info' }),
    ).toBeNull()
    expect(parseHostMessage({ type: 'SG_INIT' })).toBeNull()
    expect(
      parseHostMessage({ type: 'SG_DECK_STATE', seed: '1', index: 0 }),
    ).toBeNull()
    expect(
      parseHostMessage({ type: 'SG_STYLE_APPLIED', style: null }),
    ).toBeNull()
    expect(
      parseHostMessage({ type: 'SG_WILDCARDS_ACTIVE', categories: 'x' }),
    ).toBeNull()
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
        origin: window.location.origin,
        source: window,
        data: { type: 'SG_CLOSE' },
      } as unknown as MessageEvent),
    ).toBe(false)
    expect(
      isTrustedHostEvent({
        origin: window.location.origin,
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

  it('sendToHost posts with window.location.origin, never *', () => {
    stubHostParent()
    sendToHost({ type: 'SG_READY' })
    expect(hostParent.postMessage).toHaveBeenCalledWith(
      { type: 'SG_READY' },
      window.location.origin,
    )
    expect(hostParent.postMessage).not.toHaveBeenCalledWith(
      expect.anything(),
      '*',
    )
  })
})
