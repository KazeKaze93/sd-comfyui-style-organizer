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

/** Id-form source_file as emitted by the server since dbe3f77. */
const FILE_A = 'data/a.csv'
const FILE_B = 'imports/b.csv'

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
    thumbVersions: {},
  })
  vi.mocked(sendToHost).mockClear()
}

describe('style identity (name, source_file)', () => {
  beforeEach(() => {
    __resetAmbiguousToastForTests()
    resetStore()
  })

  it('conflict: weighted pale skin vs bare negative is one conflict', () => {
    const a = row('A', FILE_A, {
      prompt: '(pale skin:1.2)',
      negative_prompt: '',
    })
    const b = row('B', FILE_B, {
      prompt: 'other',
      negative_prompt: 'pale skin',
    })
    useStylesStore.getState().setStyles([a, b])
    useStylesStore.getState().toggleStyle(a)
    useStylesStore.getState().toggleStyle(b)
    useStylesStore.getState().detectConflicts()
    expect(useStylesStore.getState().conflicts).toHaveLength(1)
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

  it('unapply A sends source_file data/a.csv; B stays selected', () => {
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
    expect(migrated.identical).toEqual([])
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

  it('toasts ambiguous bare favorites once per signature; missing never toasts', async () => {
    const a = row('X', FILE_A, { prompt: 'from-a' })
    const b = row('X', FILE_B, { prompt: 'from-b' })
    const toastSpy = vi.spyOn(useStylesStore.getState(), 'showToast')

    localStorage.setItem('sg_v2_favorites', JSON.stringify(['X']))
    useStylesStore.getState().setStyles([a, b])
    useStylesStore.getState().setStyles([a, b])
    await Promise.resolve()
    await Promise.resolve()

    const ambiguousToasts = toastSpy.mock.calls.filter(([msg]) =>
      String(msg).includes('differ between packs'),
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
      String(msg).includes('differ between packs'),
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

  it('remaps abs-path favorite to unique source id and persists', () => {
    const a = row('X', 'data/a.csv', { prompt: 'from-a' })
    const b = row('X', 'imports/b.csv', { prompt: 'from-b' })
    const legacy = 'D:\\old\\style_grid\\a.csv\0X'
    localStorage.setItem('sg_v2_favorites', JSON.stringify([legacy]))
    useStylesStore.getState().setStyles([a, b])

    const want = styleRowKey(a)
    expect(useStylesStore.getState().favorites.has(want)).toBe(true)
    expect(JSON.parse(localStorage.getItem('sg_v2_favorites') || '[]')).toContain(want)
    expect(JSON.parse(localStorage.getItem('sg_v2_favorites') || '[]')).not.toContain(legacy)
    expect(
      filterFavoriteStyles([a, b], '', null, useStylesStore.getState().favorites),
    ).toEqual([a])
  })

  it('keeps abs composite when leaf matches two packs with diverging content; toasts name only', async () => {
    const a = row('X', 'data/a.csv', { prompt: 'from-a' })
    const b = row('X', 'imports/a.csv', { prompt: 'from-b' })
    const legacy = 'D:\\old\\style_grid\\a.csv\0X'
    const toastSpy = vi.spyOn(useStylesStore.getState(), 'showToast')
    localStorage.setItem('sg_v2_favorites', JSON.stringify([legacy]))
    useStylesStore.getState().setStyles([a, b])
    await Promise.resolve()
    await Promise.resolve()

    expect(JSON.parse(localStorage.getItem('sg_v2_favorites') || '[]')).toContain(legacy)
    expect(useStylesStore.getState().favorites.has(legacy)).toBe(false)
    expect(useStylesStore.getState().favorites.has(styleRowKey(a))).toBe(false)
    const toasts = toastSpy.mock.calls.filter(([msg]) =>
      String(msg).includes('differ between packs'),
    )
    expect(toasts).toHaveLength(1)
    expect(String(toasts[0][0])).toContain('X')
    expect(String(toasts[0][0])).not.toMatch(/D:\\|style_grid|data\/a|imports\/a/i)
    toastSpy.mockRestore()
  })

  it('links bare favorite to every pack when content is identical; no toast', async () => {
    const a = row('X', 'data/a.csv', { prompt: 'p1', negative_prompt: 'n1' })
    const b = row('X', 'imports/b.csv', { prompt: 'p1', negative_prompt: 'n1' })
    const toastSpy = vi.spyOn(useStylesStore.getState(), 'showToast')
    localStorage.setItem('sg_v2_favorites', JSON.stringify(['X']))
    useStylesStore.getState().setStyles([a, b])
    await Promise.resolve()
    await Promise.resolve()

    expect(useStylesStore.getState().favorites.has(styleRowKey(a))).toBe(true)
    expect(useStylesStore.getState().favorites.has(styleRowKey(b))).toBe(true)
    const favView = filterFavoriteStyles(
      [a, b],
      '',
      null,
      useStylesStore.getState().favorites,
    )
    expect(favView).toHaveLength(2)
    expect(toastSpy).not.toHaveBeenCalled()
    toastSpy.mockRestore()
  })

  it('bare favorite with diverging prompts stays unlinked and toasts X', async () => {
    const a = row('X', 'data/a.csv', { prompt: 'p1', negative_prompt: 'n1' })
    const b = row('X', 'imports/b.csv', { prompt: 'p2', negative_prompt: 'n1' })
    const toastSpy = vi.spyOn(useStylesStore.getState(), 'showToast')
    localStorage.setItem('sg_v2_favorites', JSON.stringify(['X']))
    useStylesStore.getState().setStyles([a, b])
    await Promise.resolve()
    await Promise.resolve()

    expect(useStylesStore.getState().favorites.size).toBe(0)
    expect(JSON.parse(localStorage.getItem('sg_v2_favorites') || '[]')).toContain('X')
    const toasts = toastSpy.mock.calls.filter(([msg]) =>
      String(msg).includes('differ between packs'),
    )
    expect(toasts).toHaveLength(1)
    expect(String(toasts[0][0])).toContain('X')
    toastSpy.mockRestore()
  })

  it('bare recent with identical multi-pack content stays bare in LS; no toast', async () => {
    const a = row('X', 'data/a.csv', { prompt: 'p1', negative_prompt: 'n1' })
    const b = row('X', 'imports/b.csv', { prompt: 'p1', negative_prompt: 'n1' })
    const toastSpy = vi.spyOn(useStylesStore.getState(), 'showToast')
    localStorage.setItem('sg_v2_recent', JSON.stringify(['X']))
    useStylesStore.getState().setStyles([a, b])
    await Promise.resolve()
    await Promise.resolve()

    expect(useStylesStore.getState().recentNames).toEqual([])
    expect(JSON.parse(localStorage.getItem('sg_v2_recent') || '[]')).toContain('X')
    expect(toastSpy).not.toHaveBeenCalled()
    toastSpy.mockRestore()
  })

  it('links abs composite favorite to every same-leaf pack when content is identical', () => {
    const a = row('X', 'data/a.csv', { prompt: 'p1', negative_prompt: 'n1' })
    const b = row('X', 'imports/a.csv', { prompt: 'p1', negative_prompt: 'n1' })
    const legacy = 'D:\\old\\a.csv\0X'
    localStorage.setItem('sg_v2_favorites', JSON.stringify([legacy]))
    useStylesStore.getState().setStyles([a, b])

    expect(useStylesStore.getState().favorites.has(styleRowKey(a))).toBe(true)
    expect(useStylesStore.getState().favorites.has(styleRowKey(b))).toBe(true)
    const stored = JSON.parse(localStorage.getItem('sg_v2_favorites') || '[]') as string[]
    expect(stored).toContain(styleRowKey(a))
    expect(stored).toContain(styleRowKey(b))
    expect(stored).not.toContain(legacy)
  })

  it('toast lists 5 diverging favorite names then (+K more)', async () => {
    const names = Array.from({ length: 12 }, (_, i) => `N${String(i).padStart(2, '0')}`)
    const styles = names.flatMap((name) => [
      row(name, 'data/a.csv', { prompt: `p-${name}-a`, negative_prompt: 'n' }),
      row(name, 'imports/b.csv', { prompt: `p-${name}-b`, negative_prompt: 'n' }),
    ])
    const toastSpy = vi.spyOn(useStylesStore.getState(), 'showToast')
    localStorage.setItem('sg_v2_favorites', JSON.stringify(names))
    useStylesStore.getState().setStyles(styles)
    await Promise.resolve()
    await Promise.resolve()

    const toasts = toastSpy.mock.calls.filter(([msg]) =>
      String(msg).includes('differ between packs'),
    )
    expect(toasts).toHaveLength(1)
    const msg = String(toasts[0][0])
    expect(msg).toContain('12 favorites match styles that differ between packs')
    expect(msg).toContain('(+7 more)')
    const listed = names.filter((n) => msg.includes(n))
    expect(listed).toHaveLength(5)
    toastSpy.mockRestore()
  })

  it('keeps id composite when that pack is unloaded; no toast, no remap to other pack', async () => {
    const other = row('X', 'imports/gone.csv', { prompt: 'from-imports' })
    const stored = 'data/gone.csv\0X'
    const toastSpy = vi.spyOn(useStylesStore.getState(), 'showToast')
    localStorage.setItem('sg_v2_favorites', JSON.stringify([stored]))
    useStylesStore.getState().setStyles([other])
    await Promise.resolve()
    await Promise.resolve()

    expect(JSON.parse(localStorage.getItem('sg_v2_favorites') || '[]')).toContain(stored)
    expect(useStylesStore.getState().favorites.has(stored)).toBe(true)
    expect(useStylesStore.getState().favorites.has(styleRowKey(other))).toBe(false)
    expect(toastSpy).not.toHaveBeenCalled()
    toastSpy.mockRestore()
  })

  it('restores sg_v2_last_source by unique leaf; ambiguous leaf stays null', () => {
    const pack = row('X', 'imports/pack.csv')
    const other = row('Y', 'data/other.csv')
    localStorage.setItem('sg_v2_last_source', 'C:\\x\\imports\\pack.csv')
    useStylesStore.getState().setStyles([other, pack])
    expect(useStylesStore.getState().activeSource).toBe('imports/pack.csv')
    expect(localStorage.getItem('sg_v2_last_source')).toBe('imports/pack.csv')

    resetStore()
    localStorage.setItem('sg_v2_last_source', 'C:\\x\\imports\\pack.csv')
    const dataPack = row('X', 'data/pack.csv')
    const importsPack = row('X', 'imports/pack.csv')
    useStylesStore.getState().setStyles([dataPack, importsPack])
    expect(useStylesStore.getState().activeSource).toBeNull()
    expect(localStorage.getItem('sg_v2_last_source')).toBe('C:\\x\\imports\\pack.csv')
  })

  it('copies abs thumb version key to unique source-id key without deleting old', () => {
    const a = row('X', 'data/a.csv')
    const b = row('X', 'imports/b.csv')
    const absKey = 'D:\\old\\style_grid\\a.csv\0X'
    const newKey = styleRowKey(a)
    localStorage.setItem(`sg_thumb_v_${absKey}`, 'v42')
    useStylesStore.setState({ thumbVersions: { [absKey]: 'v42' } })
    useStylesStore.getState().setStyles([a, b])

    expect(localStorage.getItem(`sg_thumb_v_${absKey}`)).toBe('v42')
    expect(localStorage.getItem(`sg_thumb_v_${newKey}`)).toBe('v42')
    expect(useStylesStore.getState().thumbVersions[newKey]).toBe('v42')
    expect(useStylesStore.getState().thumbVersions[absKey]).toBe('v42')
  })

  it('does not overwrite an existing id thumb version on later setStyles', () => {
    const a = row('X', 'data/a.csv')
    const b = row('X', 'imports/b.csv')
    const absKey = 'D:\\old\\style_grid\\a.csv\0X'
    const newKey = styleRowKey(a)
    localStorage.setItem(`sg_thumb_v_${absKey}`, 'v1')
    useStylesStore.setState({ thumbVersions: { [absKey]: 'v1' } })
    useStylesStore.getState().setStyles([a, b])
    expect(localStorage.getItem(`sg_thumb_v_${newKey}`)).toBe('v1')
    expect(useStylesStore.getState().thumbVersions[newKey]).toBe('v1')

    useStylesStore.getState().bumpThumbVersion(newKey, 'v2')
    useStylesStore.getState().setStyles([a, b])

    expect(localStorage.getItem(`sg_thumb_v_${newKey}`)).toBe('v2')
    expect(useStylesStore.getState().thumbVersions[newKey]).toBe('v2')
    expect(localStorage.getItem(`sg_thumb_v_${absKey}`)).toBe('v1')
    expect(useStylesStore.getState().thumbVersions[absKey]).toBe('v1')
  })
})
