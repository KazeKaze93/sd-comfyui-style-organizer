import { create } from 'zustand'
import {
  sendToHost,
  WILDCARD_KIND_DECK,
  WILDCARD_KIND_DICE,
  type Style,
  type WildcardKind,
  type WildcardRef,
} from '../bridge'
import { wildcardKey } from '../lib/wildcardKey'
import { type DeckState } from '../lib/deckState'
import {
  parseCorruptData,
  type CorruptDataInfo,
} from '../lib/parseCorruptData'
import { tagKeySet } from '../lib/tagIdentity'
import { isSourceId, sourceLeaf } from '../lib/styleIdentity'

/** Avoid toast spam: categories() runs during render while coverage stays low. */
let categoryOrderCoverageToastShown = false

/** Memo for categories(); invalidated when styles / activeSource / categoryOrder identity changes. */
let categoryListCache: {
  styles: Style[]
  activeSource: string | null
  categoryOrder: string[]
  list: string[]
} | null = null

/** Preset style ref: legacy bare name, or backend-normalized {name, source_file, weight?}. */
export type PresetStyleEntry = string | { name: string; source_file?: string; weight?: number }

export function presetEntryName(entry: PresetStyleEntry): string | null {
  if (typeof entry === 'string') return entry || null
  if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string') return null
  return entry.name || null
}

/** Chip/card label: strip leading `Category_` prefix when present. */
export function styleDisplayName(name: string): string {
  return name.includes('_') ? name.split('_').slice(1).join(' ') : name
}

/** Default Save-set name: first two display names, then `+K` for the rest. */
export function suggestPresetName(styles: Pick<Style, 'name'>[]): string {
  if (styles.length === 0) return ''
  const names = styles.map((s) => styleDisplayName(s.name))
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} + ${names[1]}`
  return `${names[0]} + ${names[1]} +${names.length - 2}`
}

export function packBasename(sourceFile: string | undefined | null): string | null {
  if (!sourceFile) return null
  const base = sourceFile.replace(/\\/g, '/').split('/').pop() || sourceFile
  return base.replace(/\.csv$/i, '') || null
}

export type PresetRecord = {
  styles: PresetStyleEntry[]
  created: string
  wildcards?: WildcardRef[]
  note?: string
  last_used?: string
}

interface Conflict {
  styleA: string
  styleB: string
  styleAKey: string
  styleBKey: string
  reason: string
}

export type ThemeMode = 'light' | 'dark'

// Fixed palettes of visually distinct colors — no duplicates. Both palettes
// share hue order so a category keeps its hue when the theme flips.
// DARK: >= 4.5:1 on #1a1a2e / #16213e / #0f172a. LIGHT: >= 4.5:1 on #fff / #f8fafc.
export const DARK_CATEGORY_PALETTE: readonly string[] = [
  '#f472b6', // pink
  '#fb923c', // orange
  '#facc15', // yellow
  '#4ade80', // green
  '#34d399', // emerald
  '#22d3ee', // cyan
  '#60a5fa', // blue
  '#818cf8', // indigo
  '#a78bfa', // violet
  '#e879f9', // fuchsia
  '#f87171', // red
  '#a3e635', // lime
  '#2dd4bf', // teal
  '#38bdf8', // sky
  '#c084fc', // purple
  '#fb7185', // rose
  '#fdba74', // amber
  '#86efac', // light green
  '#93c5fd', // light blue
  '#fda4af', // light pink
  '#6ee7b7', // light teal
  '#fcd34d', // light yellow
  '#d8b4fe', // light purple
  '#67e8f9', // light cyan
  '#bbf7d0', // mint
  '#fecaca', // salmon
  '#bfdbfe', // powder blue
  '#ddd6fe', // lavender
  '#fed7aa', // peach
  '#fbbf24', // gold
]

// Tailwind 700 for the base hues; the lighter dark-mode variants use 800 so
// they stay distinct from their 700 siblings.
export const LIGHT_CATEGORY_PALETTE: readonly string[] = [
  '#be185d', // pink-700
  '#c2410c', // orange-700
  '#a16207', // yellow-700
  '#15803d', // green-700
  '#047857', // emerald-700
  '#0e7490', // cyan-700
  '#1d4ed8', // blue-700
  '#4338ca', // indigo-700
  '#6d28d9', // violet-700
  '#a21caf', // fuchsia-700
  '#b91c1c', // red-700
  '#4d7c0f', // lime-700
  '#0f766e', // teal-700
  '#0369a1', // sky-700
  '#7e22ce', // purple-700
  '#be123c', // rose-700
  '#b45309', // amber-700
  '#166534', // green-800
  '#1e40af', // blue-800
  '#9d174d', // pink-800
  '#065f46', // emerald-800
  '#854d0e', // yellow-800
  '#6b21a8', // purple-800
  '#155e75', // cyan-800
  '#115e59', // teal-800
  '#991b1b', // red-800
  '#075985', // sky-800
  '#5b21b6', // violet-800
  '#9a3412', // orange-800
  '#92400e', // amber-800
]

/** Maps category text to a stable palette index for repeatable colors. */
export function getCategoryColor(category: string, mode: ThemeMode = 'dark'): string {
  const palette = mode === 'light' ? LIGHT_CATEGORY_PALETTE : DARK_CATEGORY_PALETTE

  // Deterministic index based on category name hash
  let hash = 0
  for (let i = 0; i < category.length; i++) {
    hash = category.charCodeAt(i) + ((hash << 5) - hash)
    hash = hash & hash // Convert to 32bit int
  }

  // Spread across palette using prime multiplication to avoid clustering
  const index = Math.abs(hash * 2654435761) % palette.length
  return palette[index]
}

export function useCategoryColor(category: string): string {
  return useStylesStore((s) => getCategoryColor(category, s.themeMode))
}

/** Stable React key when the same name can appear from different CSV rows. */
export function styleRowKey(s: Pick<Style, 'name' | 'source_file'>): string {
  return `${s.source_file}\0${s.name}`
}

const THUMB_VERSION_LS_PREFIX = 'sg_thumb_v_'
const EMPTY_STYLES: readonly Style[] = []

function buildSelectedKeySet(styles: Style[]): ReadonlySet<string> {
  return new Set(styles.map((s) => styleRowKey(s)))
}

/** Category → count of selected rows; rebuilt with selectedKeySet. */
function buildSelectedCountByCategory(styles: Style[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  for (const s of styles) {
    const cat = s.category || 'OTHER'
    counts.set(cat, (counts.get(cat) ?? 0) + 1)
  }
  return counts
}

function selectionDerived(styles: Style[]): {
  selectedKeySet: ReadonlySet<string>
  selectedCountByCategory: ReadonlyMap<string, number>
} {
  return {
    selectedKeySet: buildSelectedKeySet(styles),
    selectedCountByCategory: buildSelectedCountByCategory(styles),
  }
}

/** Names with 2+ library rows; per-name arrays keep stable refs until `styles` changes. */
function buildDuplicatesByName(styles: Style[]): Map<string, readonly Style[]> {
  const buckets = new Map<string, Style[]>()
  for (const s of styles) {
    const list = buckets.get(s.name)
    if (list) list.push(s)
    else buckets.set(s.name, [s])
  }
  const out = new Map<string, readonly Style[]>()
  for (const [name, list] of buckets) {
    if (list.length > 1) out.set(name, list)
  }
  return out
}

/** One-shot hydrate of `sg_thumb_v_<styleRowKey>` → version string. */
function loadThumbVersionsFromLs(): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const lsKey = localStorage.key(i)
      if (!lsKey || !lsKey.startsWith(THUMB_VERSION_LS_PREFIX)) continue
      const version = localStorage.getItem(lsKey)
      if (typeof version === 'string' && version.length > 0) {
        out[lsKey.slice(THUMB_VERSION_LS_PREFIX.length)] = version
      }
    }
  } catch {
    // ignore corrupt / unavailable localStorage
  }
  return out
}

type StyleIdentity = Pick<Style, 'name' | 'source_file'>

/** Resolve a preset styles[] entry to a library row (name+source, else unique name). */
export function resolvePresetStyleEntry(
  entry: PresetStyleEntry,
  styles: Style[],
): Style | undefined {
  if (typeof entry === 'string') {
    const matches = styles.filter((s) => s.name === entry)
    return matches.length === 1 ? matches[0] : undefined
  }
  if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string' || !entry.name) {
    return undefined
  }
  const name = entry.name
  const source = typeof entry.source_file === 'string' ? entry.source_file : ''
  if (source) {
    const want = styleRowKey({ name, source_file: source })
    const hit = styles.find((s) => styleRowKey(s) === want)
    if (hit) return hit
  }
  const matches = styles.filter((s) => s.name === name)
  return matches.length === 1 ? matches[0] : undefined
}

function sameContent(a: Style, b: Style): boolean {
  return (a.prompt ?? '') === (b.prompt ?? '')
    && (a.negative_prompt ?? '') === (b.negative_prompt ?? '')
}

/**
 * Upgrade legacy favorites/recent entries to styleRowKey composites.
 * Composite entries: exact catalog hit or source-id kept as stored; abs/other
 * remapped by name + source leaf. Multi-pack candidates with identical prompt
 * and negative_prompt link to every pack when linkIdenticalToAll, else sit in
 * `identical` (no toast). Diverging content stays ambiguous. Bare names: unique
 * upgrades; 0 -> missing (never assigned to the first pack).
 */
export function migrateLegacyNameKeys(
  entries: string[],
  styles: Style[],
  options?: { linkIdenticalToAll?: boolean },
): { keys: string[]; ambiguous: string[]; missing: string[]; identical: string[] } {
  const keys: string[] = []
  const ambiguous: string[] = []
  const missing: string[] = []
  const identical: string[] = []
  const seenKeys = new Set<string>()
  const seenAmbiguous = new Set<string>()
  const seenMissing = new Set<string>()
  const seenIdentical = new Set<string>()
  const catalogKeys = new Set(styles.map((s) => styleRowKey(s)))
  const linkIdenticalToAll = Boolean(options?.linkIdenticalToAll)
  const pushKey = (key: string) => {
    if (!seenKeys.has(key)) {
      seenKeys.add(key)
      keys.push(key)
    }
  }
  const resolveMulti = (entry: string, candidates: Style[]) => {
    const first = candidates[0]
    const allIdentical = candidates.every((c) => sameContent(first, c))
    if (allIdentical) {
      if (linkIdenticalToAll) {
        for (const c of candidates) pushKey(styleRowKey(c))
      } else if (!seenIdentical.has(entry)) {
        seenIdentical.add(entry)
        identical.push(entry)
      }
      return
    }
    if (!seenAmbiguous.has(entry)) {
      seenAmbiguous.add(entry)
      ambiguous.push(entry)
    }
  }
  for (const entry of entries) {
    if (entry.includes('\0')) {
      const sep = entry.indexOf('\0')
      const sourcePart = entry.slice(0, sep)
      const name = entry.slice(sep + 1)
      if (catalogKeys.has(entry) || isSourceId(sourcePart)) {
        pushKey(entry)
        continue
      }
      const leaf = sourceLeaf(sourcePart)
      const candidates = styles.filter(
        (s) => s.name === name && sourceLeaf(s.source_file) === leaf,
      )
      if (candidates.length === 1) {
        pushKey(styleRowKey(candidates[0]))
      } else if (candidates.length > 1) {
        resolveMulti(entry, candidates)
      } else if (!seenMissing.has(entry)) {
        seenMissing.add(entry)
        missing.push(entry)
      }
      continue
    }
    const matches = styles.filter((s) => s.name === entry)
    if (matches.length === 1) {
      pushKey(styleRowKey(matches[0]))
    } else if (matches.length > 1) {
      resolveMulti(entry, matches)
    } else if (!seenMissing.has(entry)) {
      seenMissing.add(entry)
      missing.push(entry)
    }
  }
  return { keys, ambiguous, missing, identical }
}

/** Session guard so the ambiguous-legacy toast does not repeat on every SG_INIT. */
let lastAmbiguousToastSignature: string | null = null

/** Test-only: clear the once-per-session ambiguous toast signature. */
export function __resetAmbiguousToastForTests(): void {
  lastAmbiguousToastSignature = null
}

function readLsStringArray(lsKey: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(lsKey) || '[]')
    return Array.isArray(parsed) ? (parsed as string[]).filter((e) => typeof e === 'string') : []
  } catch {
    return []
  }
}

/** Persist composite keys plus any still-unresolved bare legacy names. */
function persistIdentityKeys(lsKey: string, keys: Iterable<string>): void {
  const keyList = [...keys]
  const keyNames = new Set(
    keyList.map((k) => {
      const i = k.indexOf('\0')
      return i < 0 ? k : k.slice(i + 1)
    }),
  )
  const unresolved = readLsStringArray(lsKey).filter(
    (e) => !e.includes('\0') && !keyNames.has(e),
  )
  localStorage.setItem(lsKey, JSON.stringify([...keyList, ...unresolved]))
}

export type ResolvedPresetMember =
  | { status: 'found'; entry: PresetStyleEntry; style: Style }
  | { status: 'missing'; entry: PresetStyleEntry; name: string; pack: string | null }

export function resolvePresetMembers(
  entries: PresetStyleEntry[],
  styles: Style[],
): ResolvedPresetMember[] {
  return entries.map((entry) => {
    const style = resolvePresetStyleEntry(entry, styles)
    if (style) return { status: 'found' as const, entry, style }
    const name = presetEntryName(entry) || '?'
    const source =
      typeof entry === 'object' && entry && typeof entry.source_file === 'string'
        ? entry.source_file
        : ''
    return { status: 'missing' as const, entry, name, pack: packBasename(source) }
  })
}

const COMBOS_CONFLICTS_RE = /\b(?:Combos|Conflicts):\s*[^.]*\.?/gi

function stripStyleReferences(description: string): string {
  return description.replace(COMBOS_CONFLICTS_RE, '').trim()
}

function nameSearchText(style: Style): string {
  const spaced = style.name.replace(/_/g, ' ')
  const displayName = style.name.includes('_')
    ? style.name.split('_').slice(1).join(' ')
    : style.name
  return [style.name, spaced, displayName].join(' ').toLowerCase()
}

function buildStyleSearchText(style: Style): string {
  const cleanDescription = stripStyleReferences(style.description || '')
  return [nameSearchText(style), cleanDescription].filter(Boolean).join(' ').toLowerCase()
}

/** Module snapshot so filters can hit precomputed haystacks without a store circular read. */
let searchTextByKeySnapshot: ReadonlyMap<string, string> = new Map()

function buildSearchTextByKey(styles: Style[]): ReadonlyMap<string, string> {
  const map = new Map<string, string>()
  for (const s of styles) {
    map.set(styleRowKey(s), buildStyleSearchText(s))
  }
  searchTextByKeySnapshot = map
  return map
}

/** AND-token match against a lowercased haystack (empty query matches all). */
function matchSearchTokens(haystack: string, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return true
  return query.split(/\s+/).filter(Boolean).every((token) => haystack.includes(token))
}

export function matchesSearch(style: Style, rawQuery: string): boolean {
  const key = styleRowKey(style)
  const cached = searchTextByKeySnapshot.get(key)
  const haystack = cached !== undefined ? cached : buildStyleSearchText(style)
  return matchSearchTokens(haystack, rawQuery)
}

/** Same AND-token semantics as matchesSearch; looks up precomputed haystack by styleRowKey. */
export function matchesSearchKey(key: string, rawQuery: string): boolean {
  return matchSearchTokens(searchTextByKeySnapshot.get(key) ?? '', rawQuery)
}

/** First occurrence wins; use only when the active source is "All sources". */
export function dedupeStylesByNameForAllSources(styles: Style[]): Style[] {
  const seen = new Set<string>()
  return styles.filter((s) => {
    if (seen.has(s.name)) return false
    seen.add(s.name)
    return true
  })
}

/** Map persisted or UI source string to an entry in `sources` (exact, else unique leaf). */
function resolveSourceInList(sources: string[], preferred: string | null): string | null {
  if (!preferred || sources.length === 0) return null
  if (sources.includes(preferred)) return preferred
  // Source ids that miss exactly must not collapse across packs by basename.
  if (isSourceId(preferred)) return null
  const leaf = sourceLeaf(preferred)
  const matches = sources.filter((s) => sourceLeaf(s) === leaf)
  return matches.length === 1 ? matches[0] : null
}

/**
 * Values of `activeCategory` that are sidebar “special” views (not real CSV categories).
 * Matches Favorites / Recent; use the same checks in grid layout as those.
 */
export const FAVORITES_VIEW = '★ Favorites' as const
export const RECENT_VIEW = '🕑 Recent' as const
export const RECENT_CAP = 10
export type ActiveSpecialView = typeof FAVORITES_VIEW | typeof RECENT_VIEW | 'presets'

/** Central UI state for style filtering, selection, and host-side actions. */
interface StylesStore {
  toasts: { id: number; message: string; variant: 'success' | 'error' | 'info' }[]
  // Data
  styles: Style[]
  
  // Filters
  search: string
  activeCategory: string | null
  sources: string[]
  activeSource: string | null
  
  // Selection
  selectedStyles: Style[]
  /** styleRowKey set for `selectedStyles`; rebuilt in the same set() as selection. */
  selectedKeySet: ReadonlySet<string>
  /** Category → selected row count; rebuilt in the same set() as selectedKeySet. */
  selectedCountByCategory: ReadonlyMap<string, number>
  /** styleRowKey → lowercased search haystack; rebuilt only when `styles` change. */
  searchTextByKey: ReadonlyMap<string, string>
  /** Name → rows sharing that name (length ≥ 2); rebuilt when `styles` changes. */
  duplicatesByName: ReadonlyMap<string, readonly Style[]>
  /** Cache-bust versions keyed by styleRowKey; hydrated once from sg_thumb_v_* LS keys. */
  thumbVersions: Readonly<Record<string, string>>
  bumpThumbVersion: (key: string, version: string) => void
  /** Collapsed category names in the All/Categories views. */
  collapsedCategories: Set<string>
  compactMode: boolean
  themeMode: ThemeMode
  /** Favorite style names persisted in localStorage. */
  favorites: Set<string>
  /** Most recently applied style names (max 10). */
  recentNames: string[]
  /** Detected conflicts among current selected styles. */
  conflicts: Conflict[]
  /** User-defined category order for All Sources view. */
  categoryOrder: string[]
  /** Saved style presets from backend (`/style_grid/presets/list`). */
  presets: Record<string, PresetRecord>
  /**
   * When set, presets.json is corrupt — show a blocking banner and disable
   * preset save/rename/delete/touch until the user restores from `.bak`.
   */
  presetsCorrupt: CorruptDataInfo | null
  /** Last preset loaded via Apply; informational only (SaveSetDialog prefill). */
  activePresetName: string | null
  /** Which sources (a preset name, or the literal 'manual') currently
   * want each selected style present. Keys are styleRowKey composites. */
  styleContributors: Record<string, Set<string>>
  unapplyPreset: (name: string) => void
  
  // Actions
  setStyles: (styles: Style[]) => void
  setSearch: (q: string) => void
  setCategory: (cat: string | null) => void
  setActiveSource: (src: string | null) => void
  toggleCompact: () => void
  setThemeMode: (mode: ThemeMode) => void
  toggleCollapse: (cat: string) => void
  collapseAll: () => void
  expandAll: () => void
  selectAllInCategory: (cat: string) => void
  toggleStyle: (style: Style) => void
  setSelectedStyles: (styles: Style[]) => void
  clearAll: () => void
  /**
   * Host SG_CLEAR_SELECTION chrome reset: clears selection + key set, conflicts,
   * wildcards, active preset, and contributors. Does not send SG_UNAPPLY (host
   * already cleared the prompt). Prefer this over raw setState.
   */
  clearSelectionChrome: () => void
  activeWildcards: WildcardRef[]
  setActiveWildcards: (refs: WildcardRef[]) => void
  removeWildcard: (ref: WildcardRef) => void
  /** Shuffle deck position reported by the host; null until the host has sent it. */
  deckState: DeckState | null
  setDeckState: (state: DeckState) => void
  /** When set, the grid is picking styles for a `{sg|sgd:category:spec}` slice. */
  sliceMode: { category: string; kind: WildcardKind } | null
  /** Full style names selected for the current slice. */
  sliceSelection: string[]
  startSliceMode: (category: string, kind?: WildcardKind) => void
  exitSliceMode: () => void
  toggleSliceSelection: (name: string) => void
  /** Select all currently visible (search/filter-applied) names — caller supplies the list. */
  selectAllSlice: (names: string[]) => void
  clearSliceSelection: () => void
  showToast: (message: string, variant?: 'success' | 'error' | 'info') => void
  detectConflicts: () => void
  loadCategoryOrder: () => Promise<void>
  loadThumbnails: () => Promise<void>
  setCategoryOrder: (order: string[]) => void
  toggleFavorite: (style: StyleIdentity) => void
  clearFavorites: () => void
  isFavorite: (style: StyleIdentity) => boolean
  addToRecent: (style: StyleIdentity) => void
  clearRecent: () => void
  fetchPresets: () => Promise<void>
  savePreset: (
    name: string,
    styles: PresetStyleEntry[],
    opts?: {
      overwrite?: boolean
      wildcards?: WildcardRef[]
      note?: string
    },
  ) => Promise<{ ok: true } | { ok: false; error?: string }>
  deletePreset: (
    name: string,
  ) => Promise<{ ok: true } | { ok: false; error?: string }>
  renamePreset: (
    oldName: string,
    newName: string,
    opts?: { overwrite?: boolean },
  ) => Promise<{ ok: true } | { ok: false; error?: string }>
  touchPreset: (name: string) => Promise<void>
  /**
   * Apply a saved set by merging into the current selection/wildcards.
   * Host owns prompt injection through SG_APPLY / wildcards.
   */
  loadPreset: (name: string) => void
  /** POST /style_grid/style/save then refetch catalog into styles[]. */
  saveStyle: (payload: {
    name: string
    prompt: string
    negative_prompt: string
    description: string
    category: string
    source?: string | null
  }) => Promise<
    | { ok: true; styles: Style[] }
    | { ok: false; error?: string }
  >
  /** Drop one catalog row by (name, source_file); prune styleRowKey favorites/recent/contributors. */
  removeStyleRow: (style: Pick<Style, 'name' | 'source_file'>) => void
  
  // Derived
  categories: () => string[]
}

/**
 * Favorites grid pool: styleRowKey Set ∩ current source/search.
 * Same list the Favorites view renders — use for badge counts too.
 */
export function filterFavoriteStyles(
  styles: Style[],
  search: string,
  activeSource: string | null,
  favorites: Set<string>,
): Style[] {
  const bySource = (s: Style) => !activeSource || s.source_file === activeSource
  return styles.filter(
    (s) => favorites.has(styleRowKey(s)) && bySource(s) && matchesSearchKey(styleRowKey(s), search),
  )
}

export function selectFilteredStyles(
  styles: Style[],
  search: string,
  activeCategory: string | null,
  activeSource: string | null,
  favorites: Set<string>,
  recentNames: string[],
  presets: Record<string, PresetRecord>,
): Style[] {
  const bySource = (s: Style) => !activeSource || s.source_file === activeSource

  if (activeCategory === FAVORITES_VIEW) {
    return filterFavoriteStyles(styles, search, activeSource, favorites)
  }

  if (activeCategory === RECENT_VIEW) {
    const byKey = new Map(styles.map((s) => [styleRowKey(s), s]))
    return recentNames
      .map((key) => byKey.get(key))
      .filter((s): s is Style => s !== undefined && bySource(s))
      .filter((s) => matchesSearchKey(styleRowKey(s), search))
  }

  if (activeCategory === 'presets') {
    const order: Style[] = []
    const seen = new Set<string>()
    for (const key of Object.keys(presets).sort()) {
      for (const entry of presets[key]?.styles ?? []) {
        const style = resolvePresetStyleEntry(entry, styles)
        if (!style || !bySource(style)) continue
        const rowKey = styleRowKey(style)
        if (seen.has(rowKey)) continue
        seen.add(rowKey)
        order.push(style)
      }
    }
    return order.filter((s) => matchesSearchKey(styleRowKey(s), search))
  }

  let filtered = styles.filter(s => {
    const matchCat = !activeCategory || (s.category || 'OTHER') === activeCategory
    return bySource(s) && matchCat && matchesSearchKey(styleRowKey(s), search)
  })

  if (!activeSource) {
    filtered = dedupeStylesByNameForAllSources(filtered)
  }

  return filtered
}

/** Tag keys for conflict intersection; mirrors node drop_shared_tags identity, not /conflicts. */
function conflictTokenSet(str: string): Set<string> {
  return tagKeySet(str)
}

function tokenSetsIntersect(a: Set<string>, b: Set<string>): boolean {
  for (const t of a) {
    if (b.has(t)) return true
  }
  return false
}

/** Prefer live catalog prompt/neg; fall back to the selection snapshot if missing. */
function resolveSelectedForConflicts(selected: Style, live: Style[]): Style {
  const bySource = live.find(
    s => s.name === selected.name && s.source_file === selected.source_file
  )
  if (bySource) return bySource
  const byName = live.find(s => s.name === selected.name)
  return byName ?? selected
}

/** After selection paint — never batch conflicts into the same set() as selection. */
// Node setTimeout → Timeout; browser rAF → number (tsconfig.test pulls @types/node).
let conflictsRaf: number | ReturnType<typeof setTimeout> = 0
function clearConflictsHandle(handle: number | ReturnType<typeof setTimeout>): void {
  if (typeof handle === 'number' && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(handle)
  } else {
    clearTimeout(handle)
  }
}
function scheduleDetectConflicts(get: () => StylesStore): void {
  if (conflictsRaf !== 0) clearConflictsHandle(conflictsRaf)
  const run = () => {
    conflictsRaf = 0
    get().detectConflicts()
  }
  // Vitest/node has no rAF — setTimeout(0) still keeps conflicts off the sync toggle set().
  conflictsRaf = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(run)
    : setTimeout(run, 0)
}
function cancelScheduledDetectConflicts(): void {
  if (conflictsRaf === 0) return
  clearConflictsHandle(conflictsRaf)
  conflictsRaf = 0
}

export const useStylesStore = create<StylesStore>((set, get) => ({
  toasts: [],
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
  thumbVersions: loadThumbVersionsFromLs(),
  conflicts: [],
  categoryOrder: (() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('sg_v2_category_order') || '[]')
      return Array.isArray(parsed) ? (parsed as string[]) : []
    } catch {
      return []
    }
  })(),
  collapsedCategories: new Set(),
  compactMode: false,
  themeMode: 'dark',
  favorites: (() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('sg_v2_favorites') || '[]')
      return new Set(Array.isArray(parsed) ? (parsed as string[]) : [])
    } catch {
      return new Set<string>()
    }
  })(),
  recentNames: (() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('sg_v2_recent') || '[]')
      return Array.isArray(parsed) ? (parsed as string[]) : []
    } catch {
      return []
    }
  })(),
  presets: {},
  presetsCorrupt: null,
  activePresetName: null,
  styleContributors: {},

  bumpThumbVersion: (key, version) => {
    localStorage.setItem(`${THUMB_VERSION_LS_PREFIX}${key}`, version)
    set((s) => ({
      thumbVersions: { ...s.thumbVersions, [key]: version },
    }))
  },

  setStyles: (styles) => {
    const normalized = styles.map((s) => ({
      ...s,
      has_thumbnail: Boolean(s.has_thumbnail),
    }))
    const sources = [...new Set(
      normalized.map(s => s.source_file).filter(Boolean)
    )].sort()

    // Restore selection: exact match, else unique leaf for legacy abs paths only
    const lastSource = localStorage.getItem('sg_v2_last_source')
    const prevActive = get().activeSource
    const activeSource =
      resolveSourceInList(sources, prevActive) ??
      resolveSourceInList(sources, lastSource)

    const prevFavEntries = (() => {
      try {
        const parsed = JSON.parse(localStorage.getItem('sg_v2_favorites') || '[]')
        return Array.isArray(parsed) ? (parsed as string[]) : [...get().favorites]
      } catch {
        return [...get().favorites]
      }
    })()
    const prevRecentEntries = (() => {
      try {
        const parsed = JSON.parse(localStorage.getItem('sg_v2_recent') || '[]')
        return Array.isArray(parsed) ? (parsed as string[]) : [...get().recentNames]
      } catch {
        return [...get().recentNames]
      }
    })()
    const favMig = migrateLegacyNameKeys(prevFavEntries, normalized, {
      linkIdenticalToAll: true,
    })
    const recentMig = migrateLegacyNameKeys(prevRecentEntries, normalized, {
      linkIdenticalToAll: false,
    })
    const nextFavStore = [
      ...favMig.keys,
      ...favMig.ambiguous,
      ...favMig.missing,
      ...favMig.identical,
    ]
    const nextRecentStore = [
      ...recentMig.keys,
      ...recentMig.ambiguous,
      ...recentMig.missing,
      ...recentMig.identical,
    ]
    const prevFavStore = JSON.stringify(prevFavEntries)
    const prevRecentStore = JSON.stringify(prevRecentEntries)
    if (JSON.stringify(nextFavStore) !== prevFavStore) {
      localStorage.setItem('sg_v2_favorites', JSON.stringify(nextFavStore))
    }
    if (JSON.stringify(nextRecentStore) !== prevRecentStore) {
      localStorage.setItem('sg_v2_recent', JSON.stringify(nextRecentStore))
    }
    const favorites = new Set(favMig.keys)
    const recentNames = recentMig.keys

    // Copy abs-path thumb version keys onto unique source-id remaps (never delete old LS keys).
    const catalogKeys = new Set(normalized.map((s) => styleRowKey(s)))
    const prevThumbs = get().thumbVersions
    let nextThumbs: Record<string, string> | null = null
    for (const [key, version] of Object.entries(prevThumbs)) {
      if (!key.includes('\0')) continue
      if (catalogKeys.has(key)) continue
      const sep = key.indexOf('\0')
      const sourcePart = key.slice(0, sep)
      if (isSourceId(sourcePart)) continue
      const name = key.slice(sep + 1)
      const leaf = sourceLeaf(sourcePart)
      const candidates = normalized.filter(
        (s) => s.name === name && sourceLeaf(s.source_file) === leaf,
      )
      if (candidates.length !== 1) continue
      const newKey = styleRowKey(candidates[0])
      if (Object.prototype.hasOwnProperty.call(nextThumbs ?? prevThumbs, newKey)) continue
      if (localStorage.getItem(`${THUMB_VERSION_LS_PREFIX}${newKey}`) != null) continue
      if (nextThumbs === null) nextThumbs = { ...prevThumbs }
      nextThumbs[newKey] = version
      localStorage.setItem(`${THUMB_VERSION_LS_PREFIX}${newKey}`, version)
    }

    const patch: Partial<StylesStore> = {
      styles: normalized,
      sources,
      activeSource,
      favorites,
      recentNames,
      duplicatesByName: buildDuplicatesByName(normalized),
      searchTextByKey: buildSearchTextByKey(normalized),
    }
    if (nextThumbs) patch.thumbVersions = nextThumbs
    if (favorites.size === 0 && get().activeCategory === FAVORITES_VIEW) {
      patch.activeCategory = null
    }
    if (recentNames.length === 0 && get().activeCategory === RECENT_VIEW) {
      patch.activeCategory = null
    }
    set(patch)

    const ambiguousNames = [
      ...new Set(
        favMig.ambiguous.map((e) => {
          const i = e.indexOf('\0')
          return i < 0 ? e : e.slice(i + 1)
        }),
      ),
    ].sort()
    if (ambiguousNames.length > 0) {
      const signature = ambiguousNames.join('\n')
      if (signature !== lastAmbiguousToastSignature) {
        lastAmbiguousToastSignature = signature
        const shown = ambiguousNames.slice(0, 5)
        const extra = ambiguousNames.length - shown.length
        const list = shown.join(', ') + (extra > 0 ? ` (+${extra} more)` : '')
        const n = ambiguousNames.length
        queueMicrotask(() => {
          get().showToast(
            `${n} favorites match styles that differ between packs and were not linked: ${list}. Star the right pack again.`,
            'info',
          )
        })
      }
    }

    if (activeSource && activeSource !== lastSource) {
      localStorage.setItem('sg_v2_last_source', activeSource)
    }
    if (activeSource) {
      sendToHost({ type: 'SG_SOURCE_CHANGE', source: activeSource })
    }
    // List endpoint returns names only (not name+source); merge flags after catalog lands.
    void get().loadThumbnails()
  },
  setSearch: (search) => set({ search }),
  setCategory: (activeCategory) => set({ activeCategory }),
  setActiveSource: (activeSource) => {
    if (activeSource) {
      localStorage.setItem('sg_v2_last_source', activeSource)
    } else {
      localStorage.removeItem('sg_v2_last_source')
    }
    set({ activeSource })
    sendToHost({ type: 'SG_SOURCE_CHANGE', source: activeSource })
  },
  toggleCompact: () => set((s) => ({ compactMode: !s.compactMode })),
  setThemeMode: (themeMode) => set({ themeMode }),
  toggleCollapse: (cat) => set((s) => {
    const next = new Set(s.collapsedCategories)
    if (next.has(cat)) next.delete(cat)
    else next.add(cat)
    return { collapsedCategories: next }
  }),
  collapseAll: () => {
    const { styles, activeSource } = get()
    const src = activeSource
      ? styles.filter(s => s.source_file === activeSource)
      : styles
    const cats = [...new Set(src.map(s => s.category || 'OTHER'))]
    set({ collapsedCategories: new Set(cats) })
  },
  expandAll: () => set({ collapsedCategories: new Set() }),
  selectAllInCategory: (cat) => {
    const {
      styles, search, activeCategory, activeSource,
      selectedStyles, favorites, recentNames, presets,
    } = get()
    // Same pool as StyleGrid (search/source/special views + All-Sources dedupe).
    const visible = selectFilteredStyles(
      styles, search, activeCategory, activeSource, favorites, recentNames, presets,
    )
    const catStyles = visible.filter(s => (s.category || 'OTHER') === cat)
    if (catStyles.length === 0) return

    const allSelected = catStyles.every(s =>
      selectedStyles.some(sel => styleRowKey(sel) === styleRowKey(s))
    )

    if (allSelected) {
      const removeKeys = new Set(catStyles.map(s => styleRowKey(s)))
      const nextSelected = selectedStyles.filter(s => !removeKeys.has(styleRowKey(s)))
      set({
        selectedStyles: nextSelected,
        ...selectionDerived(nextSelected),
      })
      catStyles.forEach((style) => {
        sendToHost({ type: 'SG_UNAPPLY', styleId: style.name, source_file: style.source_file })
      })
      get().detectConflicts()
      return
    }

    const selectedKeys = new Set(selectedStyles.map(s => styleRowKey(s)))
    const toAdd = catStyles.filter(s => !selectedKeys.has(styleRowKey(s)))
    if (toAdd.length === 0) return

    const nextSelected = [...selectedStyles, ...toAdd]
    set({
      selectedStyles: nextSelected,
      ...selectionDerived(nextSelected),
    })
    toAdd.forEach((style) => {
      // Bulk select: do not bump client Recent MRU (intentional; see Recent P1/P2).
      sendToHost({
        type: 'SG_APPLY',
        styleId: style.name,
        prompt: style.prompt,
        neg: style.negative_prompt,
        source_file: style.source_file,
      })
    })
    get().detectConflicts()
  },
  toggleFavorite: (style) => {
    const key = styleRowKey(style)
    const favs = new Set(get().favorites)
    if (favs.has(key)) favs.delete(key)
    else favs.add(key)
    persistIdentityKeys('sg_v2_favorites', favs)
    // Leave Favorites view when the list is empty (sidebar row hides at count 0).
    if (favs.size === 0 && get().activeCategory === FAVORITES_VIEW) {
      set({ favorites: favs, activeCategory: null })
    } else {
      set({ favorites: favs })
    }
  },
  clearFavorites: () => {
    localStorage.setItem('sg_v2_favorites', '[]')
    if (get().activeCategory === FAVORITES_VIEW) {
      set({ favorites: new Set(), activeCategory: null })
    } else {
      set({ favorites: new Set() })
    }
  },
  isFavorite: (style) => get().favorites.has(styleRowKey(style)),
  addToRecent: (style) => {
    const key = styleRowKey(style)
    const prev = get().recentNames
    // Already at head: keep the same array ref (Sidebar Recent badge skips no-op).
    if (prev[0] === key) return
    const recent = [key, ...prev.filter((n) => n !== key)].slice(0, RECENT_CAP)
    persistIdentityKeys('sg_v2_recent', recent)
    set({ recentNames: recent })
  },
  clearRecent: () => {
    localStorage.setItem('sg_v2_recent', '[]')
    if (get().activeCategory === RECENT_VIEW) {
      set({ recentNames: [], activeCategory: null })
    } else {
      set({ recentNames: [] })
    }
  },

  toggleStyle: (style) => {
    const { selectedStyles, styleContributors } = get()
    const key = styleRowKey(style)
    const isSelected = selectedStyles.some(s => styleRowKey(s) === key)

    if (isSelected) {
      // Manual remove clears the WHOLE contributor set — explicit click wins.
      const nextContributors = { ...styleContributors }
      delete nextContributors[key]
      const nextSelected = selectedStyles.filter(s => styleRowKey(s) !== key)
      set({
        selectedStyles: nextSelected,
        ...selectionDerived(nextSelected),
        styleContributors: nextContributors,
      })
      sendToHost({ type: 'SG_UNAPPLY', styleId: style.name, source_file: style.source_file })
      scheduleDetectConflicts(get)
    } else {
      const existing = styleContributors[key] ?? new Set<string>()
      const nextSelected = [...selectedStyles, style]
      set({
        selectedStyles: nextSelected,
        ...selectionDerived(nextSelected),
        styleContributors: {
          ...styleContributors,
          [key]: new Set([...existing, 'manual']),
        },
      })
      get().addToRecent(style)
      sendToHost({
        type: 'SG_APPLY',
        styleId: style.name,
        prompt: style.prompt,
        neg: style.negative_prompt,
        source_file: style.source_file,
      })
      scheduleDetectConflicts(get)
    }
  },
  setSelectedStyles: (styles: Style[]) => set({
    selectedStyles: styles,
    ...selectionDerived(styles),
  }),
  clearAll: () => {
    const { selectedStyles } = get()
    cancelScheduledDetectConflicts()
    selectedStyles.forEach(s =>
      sendToHost({ type: 'SG_UNAPPLY', styleId: s.name, source_file: s.source_file })
    )
    set({
      selectedStyles: [],
      selectedKeySet: new Set(),
      selectedCountByCategory: new Map(),
      conflicts: [],
      activePresetName: null,
      styleContributors: {},
    })
  },
  clearSelectionChrome: () => {
    cancelScheduledDetectConflicts()
    set({
      selectedStyles: [],
      selectedKeySet: new Set(),
      selectedCountByCategory: new Map(),
      conflicts: [],
      activeWildcards: [],
      activePresetName: null,
      styleContributors: {},
    })
  },
  activeWildcards: [],
  setActiveWildcards: (refs) => set({ activeWildcards: refs }),
  deckState: null,
  setDeckState: (state) => set({ deckState: state }),
  removeWildcard: (ref) => {
    const targetKey = wildcardKey(ref.category, ref.spec, ref.kind)
    set((s) => ({
      activeWildcards: s.activeWildcards.filter(
        (c) => wildcardKey(c.category, c.spec, c.kind) !== targetKey,
      ),
    }))
    sendToHost({
      type: 'SG_REMOVE_WILDCARD',
      category: ref.category,
      spec: ref.spec ?? '',
      ...(ref.kind === WILDCARD_KIND_DECK ? { kind: WILDCARD_KIND_DECK } : {}),
    })
  },
  sliceMode: null,
  sliceSelection: [],
  startSliceMode: (category, kind = WILDCARD_KIND_DICE) => set({
    sliceMode: { category, kind },
    sliceSelection: [],
  }),
  exitSliceMode: () => set({ sliceMode: null, sliceSelection: [] }),
  toggleSliceSelection: (name) => set((s) => {
    const has = s.sliceSelection.includes(name)
    return {
      sliceSelection: has
        ? s.sliceSelection.filter((n) => n !== name)
        : [...s.sliceSelection, name],
    }
  }),
  selectAllSlice: (names) => set({ sliceSelection: [...names] }),
  clearSliceSelection: () => set({ sliceSelection: [] }),
  showToast: (message, variant = 'info') => {
    const TOAST_TTL_MS = 3000
    const TOAST_ERROR_TTL_MS = 6000
    const id = Date.now()
    set((s) => ({ toasts: [...s.toasts, { id, message, variant }] }))
    const ttl = variant === 'error' ? TOAST_ERROR_TTL_MS : TOAST_TTL_MS
    setTimeout(() => set((s) => ({
      toasts: s.toasts.filter(t => t.id !== id)
    })), ttl)
  },
  detectConflicts: () => {
    // Exact tagKey-set intersection (node drop_shared_tags identity), not substring.
    // Resolve prompt/neg from the live catalog so edits/refreshes aren't missed.
    const { selectedStyles, styles } = get()
    const conflicts: Conflict[] = []

    for (let i = 0; i < selectedStyles.length; i++) {
      for (let j = i + 1; j < selectedStyles.length; j++) {
        const a = resolveSelectedForConflicts(selectedStyles[i], styles)
        const b = resolveSelectedForConflicts(selectedStyles[j], styles)

        const aPos = conflictTokenSet(a.prompt)
        const bPos = conflictTokenSet(b.prompt)
        const aNeg = conflictTokenSet(a.negative_prompt || '')
        const bNeg = conflictTokenSet(b.negative_prompt || '')

        if (tokenSetsIntersect(bPos, aNeg)) {
          conflicts.push({
            styleA: a.name, styleB: b.name,
            styleAKey: styleRowKey(a), styleBKey: styleRowKey(b),
            reason: `${a.name} negates tags from ${b.name}`
          })
        }
        if (tokenSetsIntersect(aPos, bNeg)) {
          conflicts.push({
            styleA: b.name, styleB: a.name,
            styleAKey: styleRowKey(b), styleBKey: styleRowKey(a),
            reason: `${b.name} negates tags from ${a.name}`
          })
        }
      }
    }
    set({ conflicts })
  },
  loadThumbnails: async () => {
    try {
      const r = await fetch('/style_grid/thumbnails/list')
      if (!r.ok) return
      const data = await r.json().catch(() => null)
      const raw = data && typeof data === 'object' ? (data as { has_thumbnail?: unknown }).has_thumbnail : null
      const withThumb = new Set<string>()
      if (Array.isArray(raw)) {
        for (const entry of raw) {
          if (typeof entry === 'string') {
            // Legacy list payloads were bare names; ignore — cannot disambiguate packs.
            continue
          }
          if (
            entry &&
            typeof entry === 'object' &&
            typeof (entry as { name?: unknown }).name === 'string'
          ) {
            const name = (entry as { name: string }).name
            const source_file =
              typeof (entry as { source_file?: unknown }).source_file === 'string'
                ? (entry as { source_file: string }).source_file
                : ''
            withThumb.add(styleRowKey({ name, source_file }))
          }
        }
      }
      set((s) => {
        const styles = s.styles.map((st) => ({
          ...st,
          has_thumbnail: withThumb.has(styleRowKey(st)),
        }))
        return {
          styles,
          duplicatesByName: buildDuplicatesByName(styles),
          searchTextByKey: buildSearchTextByKey(styles),
        }
      })
    } catch {
      // ignore thumbnail list errors — leave prior flags
    }
  },
  loadCategoryOrder: async () => {
    // Prefer server; keep LS init on empty/error (migration + offline).
    try {
      const r = await fetch('/style_grid/category_order')
      if (!r.ok) return
      const data = await r.json()
      if (!Array.isArray(data) || data.length === 0) return
      const order = data.filter((x): x is string => typeof x === 'string')
      if (order.length === 0) return
      localStorage.setItem('sg_v2_category_order', JSON.stringify(order))
      localStorage.setItem('sg_v2_category_order_source', 'all')
      set({ categoryOrder: order })
    } catch {
      // keep localStorage-initialized order
    }
  },
  fetchPresets: async () => {
    const parse = (raw: unknown): Record<string, PresetRecord> =>
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? raw as Record<string, PresetRecord>
        : {}
    try {
      const r = await fetch('/style_grid/presets/list')
      const body = await r.json().catch(() => ({}))
      const corrupt = parseCorruptData(r, body)
      if (corrupt) {
        set({ presetsCorrupt: corrupt, presets: {} })
        return
      }
      if (!r.ok) return
      set({ presets: parse(body), presetsCorrupt: null })
    } catch {
      // ignore
    }
  },
  savePreset: async (name, styles, opts) => {
    if (get().presetsCorrupt) {
      return { ok: false as const, error: 'corrupt_data' }
    }
    try {
      const res = await fetch('/style_grid/presets/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          styles,
          wildcards: opts?.wildcards ?? [],
          note: opts?.note ?? '',
          overwrite: Boolean(opts?.overwrite),
        }),
      })
      const data = await res.json().catch(() => ({}))
      const corrupt = parseCorruptData(res, data)
      if (corrupt) {
        set({ presetsCorrupt: corrupt })
        return { ok: false as const, error: 'corrupt_data' }
      }
      if (!res.ok || data.ok === false || data.error) {
        return {
          ok: false as const,
          error: typeof data.error === 'string' ? data.error : undefined,
        }
      }
      if (data.presets) {
        set({ presets: data.presets })
      } else {
        await get().fetchPresets()
      }
      const nextContributors = { ...get().styleContributors }
      const catalog = get().styles
      for (const entry of styles) {
        const resolved = resolvePresetStyleEntry(entry, catalog)
        if (!resolved) continue
        const key = styleRowKey(resolved)
        const existing = nextContributors[key] ?? new Set<string>()
        const next = new Set(existing)
        next.delete('manual')
        next.add(name)
        nextContributors[key] = next
      }
      set({ styleContributors: nextContributors })
      return { ok: true as const }
    } catch {
      return { ok: false as const }
    }
  },
  deletePreset: async (name) => {
    if (get().presetsCorrupt) {
      return { ok: false as const, error: 'corrupt_data' }
    }
    try {
      const res = await fetch('/style_grid/presets/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json().catch(() => ({}))
      const corrupt = parseCorruptData(res, data)
      if (corrupt) {
        set({ presetsCorrupt: corrupt })
        return { ok: false as const, error: 'corrupt_data' }
      }
      if (!res.ok || data.ok === false || data.error) {
        return {
          ok: false as const,
          error: typeof data.error === 'string' ? data.error : undefined,
        }
      }
      const nextContributors = { ...get().styleContributors }
      const toRemove = new Set<string>()
      for (const [rowKey, contributors] of Object.entries(nextContributors)) {
        if (!contributors.has(name)) continue
        const next = new Set(contributors)
        next.delete(name)
        if (next.size === 0) {
          toRemove.add(rowKey)
          delete nextContributors[rowKey]
        } else {
          nextContributors[rowKey] = next
        }
      }
      const selectedNow = get().selectedStyles
      toRemove.forEach((rowKey) => {
        const style = selectedNow.find((s) => styleRowKey(s) === rowKey)
        if (!style) return
        sendToHost({
          type: 'SG_UNAPPLY',
          styleId: style.name,
          source_file: style.source_file,
        })
      })
      const nextSelected = selectedNow.filter((s) => !toRemove.has(styleRowKey(s)))
      if (data.presets) {
        set({
          presets: data.presets,
          selectedStyles: nextSelected,
          ...selectionDerived(nextSelected),
          styleContributors: nextContributors,
          ...(get().activePresetName === name ? { activePresetName: null } : {}),
        })
      } else {
        set({
          selectedStyles: nextSelected,
          ...selectionDerived(nextSelected),
          styleContributors: nextContributors,
        })
        if (get().activePresetName === name) {
          set({ activePresetName: null })
        }
        await get().fetchPresets()
      }
      if (toRemove.size > 0) get().detectConflicts()
      return { ok: true as const }
    } catch {
      return { ok: false as const }
    }
  },
  renamePreset: async (oldName, newName, opts) => {
    if (get().presetsCorrupt) {
      return { ok: false as const, error: 'corrupt_data' }
    }
    try {
      const res = await fetch('/style_grid/presets/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          old_name: oldName,
          new_name: newName,
          overwrite: Boolean(opts?.overwrite),
        }),
      })
      const data = await res.json().catch(() => ({}))
      const corrupt = parseCorruptData(res, data)
      if (corrupt) {
        set({ presetsCorrupt: corrupt })
        return { ok: false as const, error: 'corrupt_data' }
      }
      if (!res.ok || data.ok === false || data.error) {
        return {
          ok: false as const,
          error: typeof data.error === 'string' ? data.error : undefined,
        }
      }
      if (data.presets) {
        set({
          presets: data.presets,
          ...(get().activePresetName === oldName ? { activePresetName: newName } : {}),
        })
      } else {
        if (get().activePresetName === oldName) {
          set({ activePresetName: newName })
        }
        await get().fetchPresets()
      }
      const nextContributors = { ...get().styleContributors }
      for (const [rowKey, contributors] of Object.entries(nextContributors)) {
        if (!contributors.has(oldName)) continue
        const next = new Set(contributors)
        next.delete(oldName)
        next.add(newName)
        nextContributors[rowKey] = next
      }
      set({ styleContributors: nextContributors })
      return { ok: true as const }
    } catch {
      return { ok: false as const }
    }
  },
  touchPreset: async (name) => {
    if (get().presetsCorrupt) return
    try {
      const res = await fetch('/style_grid/presets/touch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json().catch(() => ({}))
      const corrupt = parseCorruptData(res, data)
      if (corrupt) {
        set({ presetsCorrupt: corrupt })
        return
      }
      if (data.presets) {
        set({ presets: data.presets })
      }
    } catch {
      // ignore
    }
  },
  loadPreset: (name) => {
    const preset = get().presets[name]
    if (!preset) return
    const { styles, showToast, addToRecent, detectConflicts } = get()

    const members = resolvePresetMembers(preset.styles ?? [], styles)
    const found = members.filter((m): m is Extract<ResolvedPresetMember, { status: 'found' }> =>
      m.status === 'found')
    const missing = members.filter((m) => m.status === 'missing')

    const selected = [...get().selectedStyles]
    const selectedKeys = new Set(selected.map((s) => styleRowKey(s)))
    const nextContributors = { ...get().styleContributors }
    for (const m of found) {
      const rowKey = styleRowKey(m.style)
      const existing = nextContributors[rowKey] ?? new Set<string>()
      nextContributors[rowKey] = new Set([...existing, name])

      if (selectedKeys.has(rowKey)) continue
      selectedKeys.add(rowKey)
      selected.push(m.style)
      addToRecent(m.style)
      sendToHost({
        type: 'SG_APPLY',
        styleId: m.style.name,
        prompt: m.style.prompt,
        neg: m.style.negative_prompt,
        source_file: m.style.source_file,
      })
    }
    set({
      selectedStyles: selected,
      ...selectionDerived(selected),
      activePresetName: name,
      styleContributors: nextContributors,
    })
    detectConflicts()

    const activeWc = [...get().activeWildcards]
    const activeWcKeys = new Set(activeWc.map((w) => wildcardKey(w.category, w.spec, w.kind)))
    for (const wc of preset.wildcards ?? []) {
      const cat = String(wc.category || '')
      if (!cat) continue
      const spec = String(wc.spec || '')
      const kind = wc.kind === WILDCARD_KIND_DECK ? WILDCARD_KIND_DECK : undefined
      const key = wildcardKey(cat, spec, kind)
      if (activeWcKeys.has(key)) continue
      activeWcKeys.add(key)
      if (spec) {
        sendToHost(
          kind
            ? { type: 'SG_WILDCARD_SLICE', category: cat, spec, kind }
            : { type: 'SG_WILDCARD_SLICE', category: cat, spec },
        )
      } else {
        sendToHost(
          kind
            ? { type: 'SG_WILDCARD_CATEGORY', category: cat, kind }
            : { type: 'SG_WILDCARD_CATEGORY', category: cat },
        )
      }
    }

    void get().touchPreset(name)

    if (missing.length > 0) {
      showToast(
        `Loaded ${found.length} of ${members.length} styles (${missing.length} missing)`,
        'info',
      )
    }
  },
  unapplyPreset: (name) => {
    const preset = get().presets[name]
    if (!preset) return
    const { styles, selectedStyles, activeWildcards, styleContributors, detectConflicts } = get()

    const members = resolvePresetMembers(preset.styles ?? [], styles)
    const found = members.filter((m): m is Extract<ResolvedPresetMember, { status: 'found' }> =>
      m.status === 'found')

    const nextContributors = { ...styleContributors }
    const toRemove = new Set<string>()
    for (const m of found) {
      const rowKey = styleRowKey(m.style)
      const set_ = nextContributors[rowKey]
      if (!set_) continue
      const next = new Set(set_)
      next.delete(name)
      if (next.size === 0) {
        toRemove.add(rowKey)
        delete nextContributors[rowKey]
      } else {
        nextContributors[rowKey] = next
      }
    }

    toRemove.forEach((rowKey) => {
      const style = selectedStyles.find((s) => styleRowKey(s) === rowKey)
        ?? found.find((m) => styleRowKey(m.style) === rowKey)?.style
      if (!style) return
      sendToHost({
        type: 'SG_UNAPPLY',
        styleId: style.name,
        source_file: style.source_file,
      })
    })
    const nextSelected = selectedStyles.filter((s) => !toRemove.has(styleRowKey(s)))

    // Wildcards: remove this preset's own wildcards unconditionally (no cross-preset attribution).
    const presetWcKeys = new Set(
      (preset.wildcards ?? []).map((wc) =>
        wildcardKey(String(wc.category || ''), String(wc.spec || ''), wc.kind),
      ),
    )
    const wcToRemove = activeWildcards.filter((w) =>
      presetWcKeys.has(wildcardKey(w.category, w.spec, w.kind)),
    )
    const nextActiveWildcards = activeWildcards.filter(
      (w) => !presetWcKeys.has(wildcardKey(w.category, w.spec, w.kind)),
    )
    wcToRemove.forEach((w) => {
      sendToHost({
        type: 'SG_REMOVE_WILDCARD',
        category: w.category,
        spec: w.spec ?? '',
        ...(w.kind === WILDCARD_KIND_DECK ? { kind: WILDCARD_KIND_DECK } : {}),
      })
    })

    set({
      selectedStyles: nextSelected,
      ...selectionDerived(nextSelected),
      activeWildcards: nextActiveWildcards,
      styleContributors: nextContributors,
    })
    detectConflicts()
  },
  saveStyle: async (payload) => {
    try {
      const res = await fetch('/style_grid/style/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: payload.name,
          prompt: payload.prompt,
          negative_prompt: payload.negative_prompt,
          description: payload.description,
          category: payload.category,
          source: payload.source,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false || data.error) {
        return {
          ok: false as const,
          error: typeof data.error === 'string' ? data.error : undefined,
        }
      }
      const fresh = await fetch('/style_grid/styles').then((r) => r.json())
      const flat = Object.values(fresh.categories || {}).flat() as Style[]
      get().setStyles(flat)
      return { ok: true as const, styles: flat }
    } catch {
      return { ok: false as const }
    }
  },
  removeStyleRow: ({ name, source_file }) => {
    const styles = get().styles.filter(
      (s) => !(s.name === name && s.source_file === source_file),
    )
    const selectedStyles = get().selectedStyles.filter(
      (s) => !(s.name === name && s.source_file === source_file),
    )
    const patch: Partial<StylesStore> = {
      styles,
      selectedStyles,
      ...selectionDerived(selectedStyles),
      duplicatesByName: buildDuplicatesByName(styles),
      searchTextByKey: buildSearchTextByKey(styles),
    }

    const rowKey = styleRowKey({ name, source_file })
    const favorites = new Set(get().favorites)
    if (favorites.delete(rowKey)) {
      persistIdentityKeys('sg_v2_favorites', favorites)
      patch.favorites = favorites
      if (favorites.size === 0 && get().activeCategory === FAVORITES_VIEW) {
        patch.activeCategory = null
      }
    }

    const recentNames = get().recentNames.filter((n) => n !== rowKey)
    if (recentNames.length !== get().recentNames.length) {
      persistIdentityKeys('sg_v2_recent', recentNames)
      patch.recentNames = recentNames
      if (recentNames.length === 0 && get().activeCategory === RECENT_VIEW) {
        patch.activeCategory = null
      }
    }

    const nextContributors = { ...get().styleContributors }
    if (rowKey in nextContributors) {
      delete nextContributors[rowKey]
      patch.styleContributors = nextContributors
    }

    set(patch)
  },
  setCategoryOrder: (order: string[]) => {
    // Only All Sources owns the persisted order. Under a CSV filter, categories()
    // is alphabetical anyway — skip so we don't poison the global All order.
    if (get().activeSource) return
    localStorage.setItem('sg_v2_category_order', JSON.stringify(order))
    localStorage.setItem('sg_v2_category_order_source', 'all')
    set({ categoryOrder: order })
    fetch('/style_grid/category_order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order })
    }).catch(() => {})
  },

  categories: () => {
    const { styles, activeSource, categoryOrder } = get()
    const hit = categoryListCache
    if (
      hit &&
      hit.styles === styles &&
      hit.activeSource === activeSource &&
      hit.categoryOrder === categoryOrder
    ) {
      return hit.list
    }

    const filtered = activeSource
      ? styles.filter(s => s.source_file === activeSource)
      : styles
    const all = [...new Set(
      filtered.map(s => s.category || 'OTHER')
    )]

    // When specific source selected — always alphabetical
    // Saved category order only applies to All Sources view
    let list: string[]
    if (activeSource) {
      list = all.sort()
    } else {
      // Only use saved order if it was saved for All Sources context
      // (contains most of the current categories)
      const allSorted = all.sort()
      if (categoryOrder.length === 0) {
        list = allSorted
      } else {
        const savedForSource = localStorage.getItem('sg_v2_category_order_source')
        if (savedForSource !== 'all') {
          list = allSorted
        } else {
          const relevantOrder = categoryOrder.filter(c => all.includes(c))
          const coverage = relevantOrder.length / all.length

          // If saved order covers less than 80% of current categories — ignore it
          if (coverage < 0.8) {
            if (!categoryOrderCoverageToastShown) {
              categoryOrderCoverageToastShown = true
              // categories() is called during render — defer store writes
              queueMicrotask(() => {
                get().showToast('Category order reset — new categories detected', 'info')
              })
            }
            list = allSorted
          } else {
            categoryOrderCoverageToastShown = false
            const rest = all.filter(c => !relevantOrder.includes(c)).sort()
            list = [...relevantOrder, ...rest]
          }
        }
      }
    }

    categoryListCache = { styles, activeSource, categoryOrder, list }
    return list
  }
}))

/** Keep searchTextByKey (+ module snapshot) aligned when styles change via raw setState. */
useStylesStore.subscribe((state, prev) => {
  if (state.styles === prev.styles) return
  const map = state.searchTextByKey
  if (map.size === state.styles.length) {
    let ok = true
    for (const s of state.styles) {
      if (!map.has(styleRowKey(s))) {
        ok = false
        break
      }
    }
    if (ok) {
      searchTextByKeySnapshot = map
      return
    }
  }
  useStylesStore.setState({ searchTextByKey: buildSearchTextByKey(state.styles) })
})

/** Rebuild selectedKeySet + selectedCountByCategory when selectedStyles changes (incl. raw setState bypasses). */
useStylesStore.subscribe((state, prev) => {
  if (state.selectedStyles === prev.selectedStyles) return
  const derived = selectionDerived(state.selectedStyles)
  const cur = state.selectedKeySet
  const next = derived.selectedKeySet
  let keysSame = cur.size === next.size
  if (keysSame) {
    for (const key of next) {
      if (!cur.has(key)) {
        keysSame = false
        break
      }
    }
  }
  const curCounts = state.selectedCountByCategory
  const nextCounts = derived.selectedCountByCategory
  let countsSame = curCounts.size === nextCounts.size
  if (countsSame) {
    for (const [cat, n] of nextCounts) {
      if (curCounts.get(cat) !== n) {
        countsSame = false
        break
      }
    }
  }
  if (keysSame && countsSame) return
  useStylesStore.setState({
    selectedKeySet: next,
    selectedCountByCategory: nextCounts,
  })
})

export function useIsSelected(key: string): boolean {
  return useStylesStore((s) => s.selectedKeySet.has(key))
}

export function useCategorySelectedCount(category: string): number {
  return useStylesStore((s) => s.selectedCountByCategory.get(category) ?? 0)
}

export function useStyleDuplicates(name: string): readonly Style[] {
  return useStylesStore((s) => s.duplicatesByName.get(name) ?? EMPTY_STYLES)
}

export function useThumbVersion(key: string): string {
  return useStylesStore((s) => s.thumbVersions[key] ?? '1')
}
