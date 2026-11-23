/**
 * Extension host: node-scoped panel state is posted to the iframe only for the
 * node the panel is open for (shouldSyncPanel in web/js/host_actions.js). The
 * host's use of it is covered against the real style_grid.js in
 * hostBehavior.test.ts (✕ on another node sends nothing to the panel).
 */
import { describe, expect, it } from 'vitest'
import { shouldSyncPanel } from '../../../web/js/host_actions.js'

describe('shouldSyncPanel', () => {
  const a = { id: 1 }
  const b = { id: 2 }

  it('true only for the panel node', () => {
    expect(shouldSyncPanel(a, a)).toBe(true)
  })

  it('false for another node, even one with the same contents', () => {
    expect(shouldSyncPanel(b, a)).toBe(false)
    expect(shouldSyncPanel({ id: 1 }, a)).toBe(false)
  })

  it('false with no panel node or no node', () => {
    expect(shouldSyncPanel(a, null)).toBe(false)
    expect(shouldSyncPanel(null, null)).toBe(false)
    expect(shouldSyncPanel(undefined, undefined)).toBe(false)
  })
})
