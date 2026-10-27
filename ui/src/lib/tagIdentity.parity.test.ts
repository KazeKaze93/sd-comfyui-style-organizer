import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { tagKey, tagKeySet } from './tagIdentity'

type TagIdentityFixture = {
  cases: Array<{ segment: string; key: string }>
}

const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../../tests/fixtures/tag_identity.json'),
    'utf8',
  ),
) as TagIdentityFixture

describe('tag identity parity (tagKey)', () => {
  it('loads a non-empty fixture', () => {
    expect(fixture.cases.length).toBeGreaterThan(0)
  })

  it.each(
    fixture.cases.map((c) => ({
      ...c,
      id: c.segment,
    })),
  )('tagKey($id)', ({ segment, key }) => {
    expect(tagKey(segment)).toBe(key)
  })
})

describe('tagKeySet skips', () => {
  it('skips BREAK (case-insensitive)', () => {
    expect(tagKeySet('pale skin, BREAK, other')).toEqual(new Set(['pale skin', 'other']))
    expect(tagKeySet('break, pale skin')).toEqual(new Set(['pale skin']))
  })

  it('skips {prompt}', () => {
    expect(tagKeySet('{prompt}, pale skin')).toEqual(new Set(['pale skin']))
  })

  it('skips empty segments', () => {
    expect(tagKeySet('pale skin,, ,other')).toEqual(new Set(['pale skin', 'other']))
  })
})
