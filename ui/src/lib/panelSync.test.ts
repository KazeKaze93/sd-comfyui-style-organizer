/**
 * Extension host: node-scoped panel state (SG_WILDCARDS_ACTIVE) is posted to
 * the iframe only for the node the panel is open for (shouldSyncPanel in
 * web/js/host_actions.js, used by syncWildcards in web/js/style_grid.js).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { shouldSyncPanel } from '../../../web/js/host_actions.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const HOST_SRC = fs.readFileSync(path.resolve(HERE, '../../../web/js/style_grid.js'), 'utf8')

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

describe('syncWildcards gate', () => {
  it('returns before reading the widgets when the node is not the panel node', () => {
    expect(HOST_SRC).toMatch(
      /function syncWildcards\(node\) \{\s*if \(!shouldSyncPanel\(node, currentNode\)\) return;[\s\S]{0,400}postToIframe\(\{ type: "SG_WILDCARDS_ACTIVE", categories \}\);/,
    )
  })

  it('the prompt helpers come from prompt_text.js, not a second copy in style_grid.js', () => {
    expect(HOST_SRC).toContain('} from "./prompt_text.js";')
    for (const fn of ['parseTags', 'tagKey', 'styleIsPresent', 'splitTopLevelCommas', 'activeWildcardCategories']) {
      expect(HOST_SRC).not.toContain(`function ${fn}(`)
    }
  })
})
