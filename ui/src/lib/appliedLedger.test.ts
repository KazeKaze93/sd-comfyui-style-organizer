import { describe, expect, it } from 'vitest'
import {
  LEDGER_VERSION,
  parseLedger,
  serializeLedger,
  selectFromLedger,
  subsumePresent,
  syntheticStyle,
} from '../../../web/js/applied_ledger.js'

describe('parseLedger', () => {
  it('accepts a valid v1 ledger', () => {
    expect(
      parseLedger({
        v: LEDGER_VERSION,
        entries: [
          {
            name: 'A',
            source_file: 'data/x.csv',
            prompt: '1boy',
            negative_prompt: '',
          },
        ],
      }),
    ).toEqual([
      {
        name: 'A',
        source_file: 'data/x.csv',
        prompt: '1boy',
        negative_prompt: '',
      },
    ])
  })

  it('returns null for wrong version', () => {
    expect(parseLedger({ v: 99, entries: [] })).toBeNull()
  })

  it('drops malformed entries', () => {
    expect(
      parseLedger({
        v: 1,
        entries: [
          { name: 'ok', source_file: '', prompt: 'a', negative_prompt: '' },
          { name: 'bad', source_file: '', prompt: 1, negative_prompt: '' },
          null,
          { name: 'also', source_file: 2, prompt: '', negative_prompt: '' },
        ],
      }),
    ).toEqual([
      { name: 'ok', source_file: '', prompt: 'a', negative_prompt: '' },
    ])
  })

  it('returns null for non-objects', () => {
    expect(parseLedger(null)).toBeNull()
    expect(parseLedger(undefined)).toBeNull()
    expect(parseLedger('x')).toBeNull()
    expect(parseLedger([])).toBeNull()
  })
})

describe('serializeLedger', () => {
  it('round-trips through parseLedger', () => {
    const entries = [
      {
        name: 'A',
        source_file: 's.csv',
        prompt: 'p',
        negative_prompt: 'n',
      },
    ]
    expect(parseLedger(serializeLedger(entries))).toEqual(entries)
  })
})

describe('subsumePresent', () => {
  const keysOf = (s: { pos: string[]; neg: string[] }) => ({
    pos: new Set(s.pos),
    neg: new Set(s.neg),
  })

  it('drops 1-tag A when B is a strict pos superset', () => {
    const a = { id: 'A', pos: ['1boy'], neg: [] as string[] }
    const b = { id: 'B', pos: ['1boy', 'muscular'], neg: [] as string[] }
    expect(subsumePresent([a, b], keysOf).map((s) => s.id)).toEqual(['B'])
  })

  it('keeps A when B lacks one of A tags', () => {
    const a = { id: 'A', pos: ['1boy', 'solo'], neg: [] as string[] }
    const b = { id: 'B', pos: ['1boy', 'muscular'], neg: [] as string[] }
    expect(subsumePresent([a, b], keysOf).map((s) => s.id)).toEqual(['A', 'B'])
  })

  it('keeps A when A.neg is not a subset of B.neg', () => {
    const a = { id: 'A', pos: ['1boy'], neg: ['lowres'] }
    const b = { id: 'B', pos: ['1boy', 'muscular'], neg: [] as string[] }
    expect(subsumePresent([a, b], keysOf).map((s) => s.id)).toEqual(['A', 'B'])
  })

  it('keeps both when key sets are identical', () => {
    const a = { id: 'A', pos: ['1boy'], neg: [] as string[] }
    const b = { id: 'B', pos: ['1boy'], neg: [] as string[] }
    expect(subsumePresent([a, b], keysOf).map((s) => s.id)).toEqual(['A', 'B'])
  })
})

describe('selectFromLedger', () => {
  it('keeps present entries and drops absent ones', () => {
    const entries = [
      { name: 'keep', prompt: 'a' },
      { name: 'drop', prompt: 'b' },
    ]
    expect(
      selectFromLedger(entries, (e) => e.name === 'keep'),
    ).toEqual({
      kept: [{ name: 'keep', prompt: 'a' }],
      dropped: [{ name: 'drop', prompt: 'b' }],
    })
  })
})

describe('syntheticStyle', () => {
  it('fills every Style field with the documented defaults', () => {
    expect(
      syntheticStyle({
        name: 'N',
        source_file: 's.csv',
        prompt: 'p',
        negative_prompt: 'n',
      }),
    ).toEqual({
      name: 'N',
      prompt: 'p',
      negative_prompt: 'n',
      source_file: 's.csv',
      description: '',
      category: '',
      has_thumbnail: false,
      read_only: true,
    })
  })
})
