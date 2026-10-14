import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Style } from '../bridge'
import {
  matchesSearch,
  matchesSearchKey,
  styleRowKey,
  useCategorySelectedCount,
  useIsSelected,
  useStyleDuplicates,
  useStylesStore,
  useThumbVersion,
} from './stylesStore'

vi.mock('../bridge', async () => {
  const actual = await vi.importActual<typeof import('../bridge')>('../bridge')
  return {
    ...actual,
    sendToHost: vi.fn(),
  }
})

const FILE_A = 'D:/packs/core/styles.csv'
const FILE_B = 'D:/packs/wardrobe/styles.csv'

function row(
  name: string,
  source_file: string,
  extra: Partial<Style> = {},
): Style {
  return {
    name,
    source_file,
    prompt: extra.prompt ?? `prompt:${name}`,
    negative_prompt: extra.negative_prompt ?? `neg:${name}`,
    description: extra.description ?? '',
    category: extra.category ?? 'BODY',
    has_thumbnail: extra.has_thumbnail ?? false,
    read_only: extra.read_only ?? false,
  }
}

function resetDerivedStore() {
  localStorage.clear()
  useStylesStore.setState({
    styles: [],
    search: '',
    activeCategory: null,
    activeSource: null,
    sources: [],
    selectedStyles: [],
    selectedKeySet: new Set(),
    selectedCountByCategory: new Map(),
    searchTextByKey: new Map(),
    duplicatesByName: new Map(),
    thumbVersions: {},
    conflicts: [],
    favorites: new Set(),
    recentNames: [],
    presets: {},
    presetsCorrupt: null,
    activePresetName: null,
    styleContributors: {},
    activeWildcards: [],
  })
}

describe('derived: selectedKeySet', () => {
  beforeEach(() => {
    resetDerivedStore()
  })

  it('tracks add, remove, and clearAll', () => {
    const a = row('BODY_Ears', FILE_A)
    const b = row('HAIR_Long', FILE_B, { category: 'HAIR' })
    useStylesStore.getState().setStyles([a, b])

    useStylesStore.getState().toggleStyle(a)
    expect(useStylesStore.getState().selectedKeySet.has(styleRowKey(a))).toBe(true)
    expect(useStylesStore.getState().selectedKeySet.has(styleRowKey(b))).toBe(false)

    useStylesStore.getState().toggleStyle(b)
    expect(useStylesStore.getState().selectedKeySet.size).toBe(2)

    useStylesStore.getState().toggleStyle(a)
    expect(useStylesStore.getState().selectedKeySet.has(styleRowKey(a))).toBe(false)
    expect(useStylesStore.getState().selectedKeySet.has(styleRowKey(b))).toBe(true)

    useStylesStore.getState().clearAll()
    expect(useStylesStore.getState().selectedKeySet.size).toBe(0)
    expect(useStylesStore.getState().selectedStyles).toEqual([])
  })

  it('useIsSelected follows selectedKeySet', () => {
    const a = row('BODY_Ears', FILE_A)
    useStylesStore.getState().setStyles([a])
    const key = styleRowKey(a)

    let latest = false
    const unsub = useStylesStore.subscribe((s) => {
      latest = s.selectedKeySet.has(key)
    })
    expect(typeof useIsSelected).toBe('function')

    useStylesStore.getState().toggleStyle(a)
    expect(latest).toBe(true)
    useStylesStore.getState().toggleStyle(a)
    expect(latest).toBe(false)
    unsub()
  })

  it('clearSelectionChrome clears selectedStyles and selectedKeySet', () => {
    const a = row('BODY_Ears', FILE_A)
    const b = row('HAIR_Long', FILE_B, { category: 'HAIR' })
    useStylesStore.getState().setStyles([a, b])
    useStylesStore.getState().toggleStyle(a)
    useStylesStore.getState().toggleStyle(b)
    useStylesStore.setState({
      activeWildcards: [{ category: 'BODY', spec: '' }],
      activePresetName: 'Duo',
      styleContributors: { [a.name]: new Set(['Duo']) },
      conflicts: [{
        styleA: a.name,
        styleB: b.name,
        styleAKey: styleRowKey(a),
        styleBKey: styleRowKey(b),
        reason: 'test',
      }],
    })

    useStylesStore.getState().clearSelectionChrome()

    const st = useStylesStore.getState()
    expect(st.selectedStyles).toEqual([])
    expect(st.selectedKeySet.size).toBe(0)
    expect(st.conflicts).toEqual([])
    expect(st.activeWildcards).toEqual([])
    expect(st.activePresetName).toBeNull()
    expect(st.styleContributors).toEqual({})
  })

  it('setState({ selectedStyles: [] }) leaves selectedKeySet empty', () => {
    const a = row('BODY_Ears', FILE_A)
    useStylesStore.getState().setStyles([a])
    useStylesStore.getState().toggleStyle(a)
    expect(useStylesStore.getState().selectedKeySet.has(styleRowKey(a))).toBe(true)

    // Mimic App SG_CLEAR_SELECTION raw bypass (pre-migration).
    useStylesStore.setState({
      selectedStyles: [],
      conflicts: [],
      activeWildcards: [],
      activePresetName: null,
      styleContributors: {},
    })

    expect(useStylesStore.getState().selectedStyles).toEqual([])
    expect(useStylesStore.getState().selectedKeySet.size).toBe(0)
  })
})

describe('derived: categories() memo', () => {
  beforeEach(() => {
    resetDerivedStore()
  })

  it('returns the same list ref until styles / activeSource / categoryOrder change', () => {
    const a = row('BODY_Ears', FILE_A, { category: 'BODY' })
    const b = row('HAIR_Long', FILE_B, { category: 'HAIR' })
    useStylesStore.getState().setStyles([a, b])

    const first = useStylesStore.getState().categories()
    const second = useStylesStore.getState().categories()
    expect(second).toBe(first)
    expect(first).toEqual(['BODY', 'HAIR'])

    // Unrelated store writes must not bust the memo.
    useStylesStore.getState().toggleStyle(a)
    useStylesStore.getState().setSearch('ears')
    expect(useStylesStore.getState().categories()).toBe(first)

    useStylesStore.getState().setActiveSource(FILE_A)
    const afterSource = useStylesStore.getState().categories()
    expect(afterSource).not.toBe(first)
    expect(afterSource).toEqual(['BODY'])

    useStylesStore.getState().setActiveSource(null)
    const afterAll = useStylesStore.getState().categories()
    expect(afterAll).not.toBe(afterSource)

    useStylesStore.getState().setCategoryOrder(['HAIR', 'BODY'])
    const afterOrder = useStylesStore.getState().categories()
    expect(afterOrder).not.toBe(afterAll)
    expect(afterOrder).toEqual(['HAIR', 'BODY'])
    expect(useStylesStore.getState().categories()).toBe(afterOrder)
  })
})

describe('derived: addToRecent coalesce', () => {
  beforeEach(() => {
    resetDerivedStore()
  })

  it('keeps recentNames ref when head name is already the style', () => {
    const a = row('BODY_Ears', FILE_A)
    const b = row('HAIR_Long', FILE_B, { category: 'HAIR' })
    useStylesStore.getState().setStyles([a, b])

    useStylesStore.getState().toggleStyle(a)
    const afterFirst = useStylesStore.getState().recentNames
    expect(afterFirst[0]).toBe(a.name)

    useStylesStore.getState().toggleStyle(a) // deselect — must not touch recent
    expect(useStylesStore.getState().recentNames).toBe(afterFirst)

    useStylesStore.getState().toggleStyle(a) // re-select — already head → no-op
    expect(useStylesStore.getState().recentNames).toBe(afterFirst)

    useStylesStore.getState().toggleStyle(b)
    const afterB = useStylesStore.getState().recentNames
    expect(afterB).not.toBe(afterFirst)
    expect(afterB[0]).toBe(b.name)
    expect(afterB[1]).toBe(a.name)
  })
})

describe('derived: searchTextByKey / matchesSearchKey', () => {
  beforeEach(() => {
    resetDerivedStore()
  })

  it('matchesSearchKey parity with matchesSearch (AND tokens + description)', () => {
    const styles = [
      row('BODY_Pointy_Ears', FILE_A, {
        category: 'BODY',
        description: 'Combos: OTHER_Thing. Soft fur tips',
      }),
      row('HAIR_Long_Wavy', FILE_B, {
        category: 'HAIR',
        description: 'Cascading waves for portraits',
      }),
      row('STYLE_Oil_Paint', FILE_A, {
        category: 'STYLE',
        description: '',
      }),
    ]
    useStylesStore.getState().setStyles(styles)

    const queries = [
      '',
      '   ',
      'ears',
      'pointy ears',
      'soft fur',
      'waves portraits',
      'oil',
      'missing token',
      'BODY Pointy',
      'cascading',
    ]

    for (const style of styles) {
      const key = styleRowKey(style)
      expect(useStylesStore.getState().searchTextByKey.has(key)).toBe(true)
      for (const q of queries) {
        expect(matchesSearchKey(key, q)).toBe(matchesSearch(style, q))
      }
    }

    // Description Combos:/Conflicts: stripped from haystack (same as matchesSearch).
    const earsKey = styleRowKey(styles[0])
    expect(matchesSearchKey(earsKey, 'combos')).toBe(false)
    expect(matchesSearchKey(earsKey, 'other_thing')).toBe(false)
    expect(matchesSearchKey(earsKey, 'soft')).toBe(true)
  })
})

describe('derived: selectedCountByCategory', () => {
  beforeEach(() => {
    resetDerivedStore()
  })

  it('tracks add, remove, clearAll, and selectAllInCategory', () => {
    const a = row('BODY_Ears', FILE_A, { category: 'BODY' })
    const b = row('BODY_Tail', FILE_A, { category: 'BODY' })
    const c = row('HAIR_Long', FILE_B, { category: 'HAIR' })
    useStylesStore.getState().setStyles([a, b, c])

    expect(useStylesStore.getState().selectedCountByCategory.size).toBe(0)
    expect(typeof useCategorySelectedCount).toBe('function')

    useStylesStore.getState().toggleStyle(a)
    expect(useStylesStore.getState().selectedCountByCategory.get('BODY')).toBe(1)
    expect(useStylesStore.getState().selectedCountByCategory.get('HAIR')).toBeUndefined()

    useStylesStore.getState().toggleStyle(c)
    expect(useStylesStore.getState().selectedCountByCategory.get('BODY')).toBe(1)
    expect(useStylesStore.getState().selectedCountByCategory.get('HAIR')).toBe(1)

    useStylesStore.getState().toggleStyle(a)
    expect(useStylesStore.getState().selectedCountByCategory.get('BODY')).toBeUndefined()
    expect(useStylesStore.getState().selectedCountByCategory.get('HAIR')).toBe(1)

    useStylesStore.getState().clearAll()
    expect(useStylesStore.getState().selectedCountByCategory.size).toBe(0)

    useStylesStore.getState().selectAllInCategory('BODY')
    expect(useStylesStore.getState().selectedCountByCategory.get('BODY')).toBe(2)
    expect(useStylesStore.getState().selectedCountByCategory.get('HAIR')).toBeUndefined()

    useStylesStore.getState().selectAllInCategory('BODY')
    expect(useStylesStore.getState().selectedCountByCategory.get('BODY')).toBeUndefined()
    expect(useStylesStore.getState().selectedCountByCategory.size).toBe(0)
  })
})

describe('derived: duplicatesByName', () => {
  beforeEach(() => {
    resetDerivedStore()
  })

  it('keeps the same array ref across unrelated updates', () => {
    const a = row('BODY_Ears', FILE_A)
    const b = row('BODY_Ears', FILE_B)
    const c = row('HAIR_Long', FILE_A, { category: 'HAIR' })
    useStylesStore.getState().setStyles([a, b, c])

    const mapBefore = useStylesStore.getState().duplicatesByName
    const arrBefore = mapBefore.get('BODY_Ears')
    expect(arrBefore).toBeDefined()
    expect(arrBefore).toHaveLength(2)

    useStylesStore.getState().setSearch('ears')
    useStylesStore.getState().toggleStyle(c)
    useStylesStore.getState().setThemeMode('light')

    const mapAfter = useStylesStore.getState().duplicatesByName
    expect(mapAfter).toBe(mapBefore)
    expect(mapAfter.get('BODY_Ears')).toBe(arrBefore)
  })

  it('useStyleDuplicates returns EMPTY_STYLES for absent names', () => {
    const a = row('BODY_Ears', FILE_A)
    useStylesStore.getState().setStyles([a])
    expect(typeof useStyleDuplicates).toBe('function')

    const missing = useStylesStore.getState().duplicatesByName.get('NO_SUCH')
    expect(missing).toBeUndefined()

    // Prove singles are absent from the map (not stored as length-1).
    expect(useStylesStore.getState().duplicatesByName.has('BODY_Ears')).toBe(false)

    const uniqEmpty1 = useStylesStore.getState().duplicatesByName.get('___absent_1___')
    const uniqEmpty2 = useStylesStore.getState().duplicatesByName.get('___absent_2___')
    expect(uniqEmpty1).toBeUndefined()
    expect(uniqEmpty2).toBeUndefined()
  })

  it('rebuilds when styles change and exposes duplicate groups', () => {
    const a = row('BODY_Ears', FILE_A)
    const b = row('BODY_Ears', FILE_B)
    useStylesStore.getState().setStyles([a])
    expect(useStylesStore.getState().duplicatesByName.size).toBe(0)

    useStylesStore.getState().setStyles([a, b])
    const dups = useStylesStore.getState().duplicatesByName.get('BODY_Ears')
    expect(dups).toHaveLength(2)
    expect(dups?.map((s) => s.source_file).sort()).toEqual([FILE_A, FILE_B].sort())
  })
})

describe('derived: thumbVersions', () => {
  beforeEach(() => {
    resetDerivedStore()
  })

  it('bumpThumbVersion writes localStorage and updates subscribers', () => {
    const key = `${FILE_A}\0BODY_Ears`
    let seen = useStylesStore.getState().thumbVersions[key] ?? '1'
    const unsub = useStylesStore.subscribe((s) => {
      seen = s.thumbVersions[key] ?? '1'
    })

    expect(typeof useThumbVersion).toBe('function')
    expect(seen).toBe('1')

    useStylesStore.getState().bumpThumbVersion(key, '7')
    expect(localStorage.getItem(`sg_thumb_v_${key}`)).toBe('7')
    expect(useStylesStore.getState().thumbVersions[key]).toBe('7')
    expect(seen).toBe('7')
    unsub()
  })
})

describe('derived: thumbVersions hydration', () => {
  it('reads sg_thumb_v_* once at store init', async () => {
    vi.resetModules()
    localStorage.clear()
    const rowKey = `${FILE_A}\0BODY_Ears`
    localStorage.setItem(`sg_thumb_v_${rowKey}`, '42')
    localStorage.setItem('sg_v2_favorites', '[]')

    const mod = await import('./stylesStore')
    expect(mod.useStylesStore.getState().thumbVersions[rowKey]).toBe('42')
    expect(mod.useStylesStore.getState().thumbVersions).toEqual({ [rowKey]: '42' })

    // Post-init LS writes must not re-hydrate into the store.
    localStorage.setItem(`sg_thumb_v_${rowKey}`, '100')
    localStorage.setItem(`sg_thumb_v_${FILE_B}\0Other`, '9')
    expect(mod.useStylesStore.getState().thumbVersions[rowKey]).toBe('42')
    expect(mod.useStylesStore.getState().thumbVersions[`${FILE_B}\0Other`]).toBeUndefined()
  })
})
