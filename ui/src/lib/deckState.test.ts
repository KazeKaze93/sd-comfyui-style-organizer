import { describe, expect, it } from 'vitest'
import { WILDCARD_KIND_DECK, WILDCARD_KIND_DICE, type WildcardRef } from '../bridge'
import { hasDeckWildcard } from './deckState'

describe('hasDeckWildcard', () => {
  it('returns false for an empty list', () => {
    expect(hasDeckWildcard([])).toBe(false)
  })

  it('returns false for dice-only and kind-less refs', () => {
    const refs: WildcardRef[] = [
      { category: 'body', spec: '', kind: WILDCARD_KIND_DICE },
      { category: 'hair', spec: 'Short' },
    ]
    expect(hasDeckWildcard(refs)).toBe(false)
  })

  it('returns true when any ref has kind sgd', () => {
    const refs: WildcardRef[] = [
      { category: 'body', spec: '', kind: WILDCARD_KIND_DICE },
      { category: 'hair', spec: '', kind: WILDCARD_KIND_DECK },
    ]
    expect(hasDeckWildcard(refs)).toBe(true)
  })
})
