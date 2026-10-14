import { WILDCARD_KIND_DECK, type WildcardRef } from '../bridge'

/** Deck position reported by the host (values of the node's hidden deck_seed / deck_index widgets). */
export type DeckState = {
  seed: number
  index: number
}

/** True when at least one active wildcard is a shuffle ({sgd:...}) token. */
export function hasDeckWildcard(refs: readonly WildcardRef[]): boolean {
  return refs.some((ref) => ref.kind === WILDCARD_KIND_DECK)
}
