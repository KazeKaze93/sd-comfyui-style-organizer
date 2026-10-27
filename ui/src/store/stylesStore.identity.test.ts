import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Style } from '../bridge'
import { sendToHost } from '../bridge'
import {
  __resetAmbiguousToastForTests,
  FAVORITES_VIEW,
  filterFavoriteStyles,
  migrateLegacyNameKeys,
  styleRowKey,
  useStylesStore,
} from './stylesStore'

vi.mock('../bridge', async () => {
  const actual = await vi.importActual<typeof import('../bridge')>('../bridge')
  return {
    ...actual,
    sendToHost: vi.fn(),
  }
})

function row(
  name: string,
  source_file: string,
  extra: Partial<Style> = {},
): Style {
  return {
    name,
    source_file,
    prompt: extra.prompt ?? `prompt:${source_file}:${name}`,
    negative_prompt: extra.negative_prompt ?? `neg:${source_file}:${name}`,
    description: extra.description ?? '',
    category: extra.category ?? 'BODY',
    has_thumbnail: false,
    read_only: false,
  }
}

const FILE_A = 'a.csv'
const FILE_B = 'b.csv'

function resetStore() {
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
    conflicts: [],
    favorites: new Set(),
    recentNames: [],
    presets: {},
    presetsCorrupt: null,
    activePresetName: null,
    styleContributors: {},
    activeWildcards: [],
  })
  vi.mocked(sendToHost).mockClear()
}

describe('style identity (name, source_file)', () => {
  beforeEach(() => {
    __resetAmbiguousToastForTests()
    resetStore()
  })

  it('favorites A only then both; Favorites view lists the right packs', () => {
    const a = row('X', FILE_A, { prompt: 'from-a' })
    const b = row('X', FILE_B, { prompt: 'from-b' })
    useStylesStore.getState().setStyles([a, b])
    useStylesStore.getState().toggleFavorite(a)

    expect(useStylesStore.getState().isFavorite(a)).toBe(true)
    expect(useStylesStore.getState().isFavorite(b)).toBe(false)
    expect(
      filterFavoriteStyles([a, b], '', null, useStylesStore.getState().favorites),
    ).toEqual([a])

    useStylesStore.getState().toggleFavorite(b)
    expect(useStylesStore.getState().isFavorite(b)).toBe(true)
    const favView = filterFavoriteStyles(
      [a, b],
      '',
      null,
      useStylesStore.getState().favorites,
    )
    expect(favView).toHaveLength(2)
    expect(favView.map((s) => styleRowKey(s)).sort()).toEqual(
      [styleRowKey(a), styleRowKey(b)].sort(),
    )
  })

  it('toggle A then B selects both; APPLY carries each source_file', () => {
    const a = row('X', FILE_A, { prompt: 'from-a' })
    const b = row('X', FILE_B, { prompt: 'from-b' })
    useStylesStore.getState().setStyles([a, b])
    useStylesStore.getState().toggleStyle(a)
    useStylesStore.getState().toggleStyle(b)

    const selected = useStylesStore.getState().selectedStyles
    expect(selected).toHaveLength(2)
    expect(selected.map((s) => s.prompt).sort()).toEqual(['from-a', 'from-b'])

    const applies = vi.mocked(sendToHost).mock.calls
      .map((c) => c[0])
      .filter((m) => m.type === 'SG_APPLY')
    expect(applies).toHaveLength(2)
    expect(applies.map((m) => (m.type === 'SG_APPLY' ? m.source_file : '')).sort()).toEqual(
      [FILE_A, FILE_B].sort(),
    )
  })

  it('unapply A sends source_file a.csv; B stays selected', () => {
    const a = row('X', FILE_A, { prompt: 'from-a' })
    const b = row('X', FILE_B, { prompt: 'from-b' })
    useStylesStore.getState().setStyles([a, b])
    useStylesStore.getState().toggleStyle(a)
    useStylesStore.getState().toggleStyle(b)
    vi.mocked(sendToHost).mockClear()

    useStylesStore.getState().toggleStyle(a)

    const unapplies = vi.mocked(sendToHost).mock.calls
      .map((c) => c[0])
      .filter((m) => m.type === 'SG_UNAPPLY')
    expect(unapplies).toEqual([
      { type: 'SG_UNAPPLY', styleId: 'X', source_file: FILE_A },
    ])
    const selected = useStylesStore.getState().selectedStyles
    expect(selected).toHaveLength(1)
    expect(selected[0].source_file).toBe(FILE_B)
  })

  it('loadPreset applies both packs; unapplyPreset removes both with source_file', () => {
    const a = row('X', FILE_A, { prompt: 'from-a' })
    const b = row('X', FILE_B, { prompt: 'from-b' })
    useStylesStore.getState().setStyles([a, b])
    useStylesStore.setState({
      presets: {
        Duo: {
          styles: [
            { name: 'X', source_file: FILE_A },
            { name: 'X', source_file: FILE_B },
          ],
          wildcards: [],
          note: '',
          created: '2026-01-01T00:00:00',
        },
      },
    })

    useStylesStore.getState().loadPreset('Duo')
    expect(useStylesStore.getState().selectedStyles).toHaveLength(2)

    const applies = vi.mocked(sendToHost).mock.calls
      .map((c) => c[0])
      .filter((m) => m.type === 'SG_APPLY')
    expect(applies.map((m) => (m.type === 'SG_APPLY' ? m.source_file : '')).sort()).toEqual(
      [FILE_A, FILE_B].sort(),
    )

    vi.mocked(sendToHost).mockClear()
    useStylesStore.getState().unapplyPreset('Duo')

    const unapplies = vi.mocked(sendToHost).mock.calls
      .map((c) => c[0])
      .filter((m) => m.type === 'SG_UNAPPLY')
    expect(unapplies).toHaveLength(2)
    expect(
      unapplies
        .map((m) => (m.type === 'SG_UNAPPLY' ? m.source_file : ''))
        .sort(),
    ).toEqual([FILE_A, FILE_B].sort())
    expect(useStylesStore.getState().selectedStyles).toHaveLength(0)
  })

  it('migrateLegacyNameKeys: unique upgrades; ambiguous and missing stay separate', () => {
    const unique = row('CAMERA_Closeup', FILE_A)
    const a = row('X', FILE_A)
    const b = row('X', FILE_B)
    const migrated = migrateLegacyNameKeys(
      ['CAMERA_Closeup', 'X', 'GONE', styleRowKey(a)],
      [unique, a, b],
    )
    expect(migrated.keys).toEqual([styleRowKey(unique), styleRowKey(a)])
    expect(migrated.ambiguous).toEqual(['X'])
    expect(migrated.missing).toEqual(['GONE'])
    expect(migrated.keys).not.toContain(styleRowKey(b))
  })

  it('setStyles keeps a missing-pack favorite key in localStorage', () => {
    const a = row('X', FILE_A, { prompt: 'from-a' })
    const b = row('X', FILE_B, { prompt: 'from-b' })
    useStylesStore.getState().setStyles([a, b])
    useStylesStore.getState().toggleFavorite(b)
    expect(JSON.parse(localStorage.getItem('sg_v2_favorites') || '[]')).toContain(
      styleRowKey(b),
    )

    useStylesStore.getState().setStyles([a])
    expect(JSON.parse(localStorage.getItem('sg_v2_favorites') || '[]')).toContain(
      styleRowKey(b),
    )
    expect(useStylesStore.getState().favorites.has(styleRowKey(b))).toBe(true)
    expect(useStylesStore.getState().activeCategory).not.toBe(FAVORITES_VIEW)
  })

  it('toasts ambiguous bare names once per signature; missing never toasts', async () => {
    const a = row('X', FILE_A, { prompt: 'from-a' })
    const b = row('X', FILE_B, { prompt: 'from-b' })
    const toastSpy = vi.spyOn(useStylesStore.getState(), 'showToast')

    localStorage.setItem('sg_v2_favorites', JSON.stringify(['X']))
    useStylesStore.getState().setStyles([a, b])
    useStylesStore.getState().setStyles([a, b])
    await Promise.resolve()
    await Promise.resolve()

    const ambiguousToasts = toastSpy.mock.calls.filter(([msg]) =>
      String(msg).includes('match styles in several packs'),
    )
    expect(ambiguousToasts).toHaveLength(1)

    localStorage.setItem(
      'sg_v2_favorites',
      JSON.stringify(JSON.parse(localStorage.getItem('sg_v2_favorites') || '[]').concat(['Y'])),
    )
    const c = row('Y', FILE_A, { prompt: 'y-a' })
    const d = row('Y', FILE_B, { prompt: 'y-b' })
    useStylesStore.getState().setStyles([a, b, c, d])
    await Promise.resolve()
    await Promise.resolve()

    const afterY = toastSpy.mock.calls.filter(([msg]) =>
      String(msg).includes('match styles in several packs'),
    )
    expect(afterY).toHaveLength(2)
    expect(String(afterY[1][0])).toContain('Y')

    toastSpy.mockClear()
    localStorage.setItem('sg_v2_favorites', JSON.stringify(['MISSING_ONLY']))
    useStylesStore.getState().setStyles([a, b])
    await Promise.resolve()
    await Promise.resolve()
    expect(toastSpy).not.toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem('sg_v2_favorites') || '[]')).toContain(
      'MISSING_ONLY',
    )

    toastSpy.mockRestore()
  })
})
