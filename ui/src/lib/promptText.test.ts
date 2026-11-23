/**
 * Extension host (web/js/prompt_text.js): the pure prompt-text helpers the
 * host uses to read the node text — tag parsing, style presence, wildcard tokens.
 */
import { describe, expect, it } from 'vitest'
import {
  activeWildcardCategories,
  parseTags,
  splitTopLevelCommas,
  styleIsPresent,
  tagKey,
} from '../../../web/js/prompt_text.js'

describe('parseTags / tagKey', () => {
  it('splits on top-level commas, trims and drops empty tags', () => {
    expect(parseTags(' tall , (red hair:1.2),, long legs ,')).toEqual(['tall', '(red hair:1.2)', 'long legs'])
    expect(parseTags('')).toEqual([])
    expect(parseTags('   ')).toEqual([])
  })

  it('tagKey drops the weight wrapper, trims and lowercases', () => {
    expect(tagKey('(Red Hair:1.2)')).toBe('red hair')
    expect(tagKey('(tall:1)')).toBe('tall')
    expect(tagKey('  Long Legs ')).toBe('long legs')
    expect(tagKey('(not a weight)')).toBe('(not a weight)')
  })
})

describe('splitTopLevelCommas', () => {
  it('keeps commas inside parentheses, also nested', () => {
    expect(splitTopLevelCommas('a, ((b, c), d), e')).toEqual(['a', '((b, c), d)', 'e'])
  })

  it('keeps commas inside braces (slice tokens), also nested', () => {
    expect(splitTopLevelCommas('{sg:hair:1,3}, x, {a, {b, c}}')).toEqual(['{sg:hair:1,3}', 'x', '{a, {b, c}}'])
  })

  it('square brackets do not group: commas inside them split', () => {
    expect(splitTopLevelCommas('[a, b], c')).toEqual(['[a', 'b]', 'c'])
  })

  it('an unbalanced closer does not go below depth zero', () => {
    expect(splitTopLevelCommas('a), b, (c, d')).toEqual(['a)', 'b', '(c, d'])
  })

  it('empty, blank and non-string input', () => {
    expect(splitTopLevelCommas('')).toEqual([])
    expect(splitTopLevelCommas('  ')).toEqual([])
    expect(splitTopLevelCommas(null as unknown as string)).toEqual([])
  })
})

describe('styleIsPresent', () => {
  const style = { prompt: 'tall, long legs', negative_prompt: 'short' }

  it('true when every tag of both sides is in the node text, weights and case ignored', () => {
    expect(styleIsPresent('red, Tall, (long legs:1.3)', 'short, blurry', style)).toBe(true)
  })

  it('false when the tags are partly erased', () => {
    expect(styleIsPresent('tall', 'short', style)).toBe(false)
    expect(styleIsPresent('tall, long legs', '', style)).toBe(false)
  })

  it('a style with no prompt and no negative is never present', () => {
    expect(styleIsPresent('anything', 'anything', { prompt: '', negative_prompt: '' })).toBe(false)
  })

  it('one empty side does not need the other widget', () => {
    expect(styleIsPresent('tall, long legs', '', { prompt: 'tall, long legs', negative_prompt: '' })).toBe(true)
  })

  it('a {prompt} wrap is present when its prefix and suffix frame the text', () => {
    const wrap = { prompt: 'masterpiece, {prompt}, detailed', negative_prompt: '' }
    expect(styleIsPresent('masterpiece, a cat, detailed', '', wrap)).toBe(true)
    expect(styleIsPresent('a cat, detailed', '', wrap)).toBe(false)
    expect(styleIsPresent('', '', wrap)).toBe(false)
  })
})

describe('activeWildcardCategories', () => {
  it('reads sg (dice) and sgd (deck) tokens, with and without a slice', () => {
    expect(activeWildcardCategories('tall, {sg:hair}, {sgd:body:1-3}', '')).toEqual([
      { category: 'hair', spec: '', kind: 'sg', token: '{sg:hair}' },
      { category: 'body', spec: '1-3', kind: 'sgd', token: '{sgd:body:1-3}' },
    ])
  })

  it('reads negative_text too, after the positive tokens', () => {
    expect(activeWildcardCategories('{sg:hair}', '{sgd:eyes:2,4}')).toEqual([
      { category: 'hair', spec: '', kind: 'sg', token: '{sg:hair}' },
      { category: 'eyes', spec: '2,4', kind: 'sgd', token: '{sgd:eyes:2,4}' },
    ])
  })

  it('lowercases the category and kind, keeps the spec as typed', () => {
    expect(activeWildcardCategories('{SGD:Hair:Red Hair}', '')).toEqual([
      { category: 'hair', spec: 'Red Hair', kind: 'sgd', token: '{SGD:Hair:Red Hair}' },
    ])
  })

  it('one entry per (category, spec, kind) across both widgets; dice and deck stay apart', () => {
    const out = activeWildcardCategories('{sg:hair}, {SG:Hair}, {sgd:hair}', '{sg:hair}')
    expect(out.map((e) => [e.category, e.spec, e.kind])).toEqual([
      ['hair', '', 'sg'],
      ['hair', '', 'sgd'],
    ])
  })

  it('no tokens → empty', () => {
    expect(activeWildcardCategories('tall, {not a token}', '')).toEqual([])
    expect(activeWildcardCategories('', '')).toEqual([])
  })
})
