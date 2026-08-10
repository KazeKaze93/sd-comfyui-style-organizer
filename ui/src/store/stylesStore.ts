import { create } from 'zustand'
import { sendToHost, type Style } from '../bridge'

/** Avoid toast spam: categories() runs during render while coverage stays low. */
let categoryOrderCoverageToastShown = false

interface Conflict {
  styleA: string
  styleB: string
  reason: string
}

/** Maps category text to a stable palette index for repeatable colors. */
export function getCategoryColor(category: string): string {
  // Fixed palette of visually distinct colors — no duplicates
  const PALETTE = [
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
    '#bbf7d0', // seafoam
  ]

  // Deterministic index based on category name hash
  let hash = 0
  for (let i = 0; i < category.length; i++) {
    hash = category.charCodeAt(i) + ((hash << 5) - hash)
    hash = hash & hash // Convert to 32bit int
  }

  // Spread across palette using prime multiplication to avoid clustering
  const index = Math.abs(hash * 2654435761) % PALETTE.length
  return PALETTE[index]
}

/** Stable React key when the same name can appear from different CSV rows. */
export function styleRowKey(s: Pick<Style, 'name' | 'source_file'>): string {
  return `${s.source_file}\0${s.name}`
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

export function matchesSearch(style: Style, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return true
  const haystack = buildStyleSearchText(style)
  return query.split(/\s+/).filter(Boolean).every(token => haystack.includes(token))
}

export function matchesNameSearch(style: Style, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return true
  const haystack = nameSearchText(style)
  return query.split(/\s+/).filter(Boolean).every(token => haystack.includes(token))
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

/** Map persisted or UI source string to an entry in `sources` (exact match, else basename). */
function resolveSourceInList(sources: string[], preferred: string | null): string | null {
  if (!preferred || sources.length === 0) return null
  if (sources.includes(preferred)) return preferred
  const key = (s: string) => {
    const base = s.replace(/\\/g, '/').split('/').pop() ?? s
    return base.replace(/\.csv$/i, '').toLowerCase()
  }
  const k = key(preferred)
  const found = sources.find((s) => key(s) === k)
  return found ?? null
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
  /** Collapsed category names in the All/Categories views. */
  collapsedCategories: Set<string>
  compactMode: boolean
  /** Favorite style names persisted in localStorage. */
  favorites: Set<string>
  /** Most recently applied style names (max 10). */
  recentNames: string[]
  /** Detected conflicts among current selected styles. */
  conflicts: Conflict[]
  /** Usage counters loaded/persisted via backend API. */
  usageCounts: Record<string, number>
  /** User-defined category order for All Sources view. */
  categoryOrder: string[]
  /** Saved style presets from backend (`/style_grid/presets/list`). */
  presets: Record<string, { styles: string[]; created: string }>
  /** Last preset loaded via StyleCard click; drives toggle-unload for partial sets. */
  activePresetName: string | null
  
  // Actions
  setStyles: (styles: Style[]) => void
  setSearch: (q: string) => void
  setCategory: (cat: string | null) => void
  setActiveSource: (src: string | null) => void
  toggleCompact: () => void
  toggleCollapse: (cat: string) => void
  collapseAll: () => void
  expandAll: () => void
  selectAllInCategory: (cat: string) => void
  toggleStyle: (style: Style) => void
  setSelectedStyles: (styles: Style[]) => void
  clearAll: () => void
  activeWildcards: string[]
  setActiveWildcards: (categories: string[]) => void
  removeWildcard: (category: string) => void
  showToast: (message: string, variant?: 'success' | 'error' | 'info') => void
  detectConflicts: () => void
  loadUsage: () => Promise<void>
  loadCategoryOrder: () => Promise<void>
  incrementUsage: (name: string) => void
  setCategoryOrder: (order: string[]) => void
  toggleFavorite: (name: string) => void
  clearFavorites: () => void
  isFavorite: (name: string) => boolean
  addToRecent: (name: string) => void
  clearRecent: () => void
  fetchPresets: () => Promise<void>
  
  // Derived
  categories: () => string[]
}

/**
 * Favorites grid pool: name-keyed Set ∩ current source/search (+ All-Sources
 * name dedupe). Same list the Favorites view renders — use for badge counts too.
 */
export function filterFavoriteStyles(
  styles: Style[],
  search: string,
  activeSource: string | null,
  favorites: Set<string>,
): Style[] {
  const bySource = (s: Style) => !activeSource || s.source_file === activeSource
  let favStyles = styles.filter(
    (s) => favorites.has(s.name) && bySource(s) && matchesSearch(s, search),
  )
  if (!activeSource) favStyles = dedupeStylesByNameForAllSources(favStyles)
  return favStyles
}

export function selectFilteredStyles(
  styles: Style[],
  search: string,
  activeCategory: string | null,
  activeSource: string | null,
  favorites: Set<string>,
  recentNames: string[],
  presets: Record<string, { styles: string[]; created: string }>,
): Style[] {
  const bySource = (s: Style) => !activeSource || s.source_file === activeSource

  if (activeCategory === FAVORITES_VIEW) {
    return filterFavoriteStyles(styles, search, activeSource, favorites)
  }

  // Name-only identity (same as Favorites/Presets/selection): first styles.find wins;
  // re-apply from Recent with cross-CSV dupes may not hit the originally applied pack.
  if (activeCategory === RECENT_VIEW) {
    return recentNames
      .map(name => styles.find(s => s.name === name && bySource(s)))
      .filter(Boolean)
      .filter(s => matchesSearch(s as Style, search)) as Style[]
  }

  if (activeCategory === 'presets') {
    const order: string[] = []
    const seen = new Set<string>()
    for (const key of Object.keys(presets).sort()) {
      for (const n of presets[key]?.styles ?? []) {
        if (!seen.has(n)) {
          seen.add(n)
          order.push(n)
        }
      }
    }
    return order
      .map(name => styles.find(s => s.name === name && bySource(s)))
      .filter(Boolean)
      .filter(s => matchesSearch(s as Style, search)) as Style[]
  }

  let filtered = styles.filter(s => {
    const matchCat = !activeCategory || (s.category || 'OTHER') === activeCategory
    return bySource(s) && matchCat && matchesSearch(s, search)
  })

  if (!activeSource) {
    filtered = dedupeStylesByNameForAllSources(filtered)
  }

  return filtered
}

/** Comma-split tokens like server detect_conflicts: trim, lower, skip empty/{prompt}. */
function conflictTokenSet(str: string): Set<string> {
  const out = new Set<string>()
  for (const part of (str || '').split(',')) {
    const t = part.trim().toLowerCase()
    if (t && t !== '{prompt}') out.add(t)
  }
  return out
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

export const useStylesStore = create<StylesStore>((set, get) => ({
  toasts: [],
  styles: [],
  search: '',
  activeCategory: null,
  activeSource: null,
  sources: [],
  selectedStyles: [],
  conflicts: [],
  usageCounts: {},
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
  activePresetName: null,

  setStyles: (styles) => {
    const sources = [...new Set(
      styles.map(s => s.source_file).filter(Boolean)
    )].sort()

    // Restore selection: exact match can fail when host path strings differ from LS (basename must match)
    const lastSource = localStorage.getItem('sg_v2_last_source')
    const prevActive = get().activeSource
    const activeSource =
      resolveSourceInList(sources, prevActive) ??
      resolveSourceInList(sources, lastSource)

    // Drop favorite names that no longer exist in the loaded catalog.
    const names = new Set(styles.map(s => s.name))
    const prevFavs = get().favorites
    let favorites = prevFavs
    if ([...prevFavs].some(n => !names.has(n))) {
      favorites = new Set([...prevFavs].filter(n => names.has(n)))
      localStorage.setItem('sg_v2_favorites', JSON.stringify([...favorites]))
    }

    const patch: Partial<StylesStore> = { styles, sources, activeSource, favorites }
    if (favorites.size === 0 && get().activeCategory === FAVORITES_VIEW) {
      patch.activeCategory = null
    }
    set(patch)
    if (activeSource) {
      localStorage.setItem('sg_v2_last_source', activeSource)
      sendToHost({ type: 'SG_SOURCE_CHANGE', source: activeSource })
    }
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
      selectedStyles.some(sel => sel.name === s.name)
    )

    if (allSelected) {
      const removeNames = new Set(catStyles.map(s => s.name))
      set({
        selectedStyles: selectedStyles.filter(s => !removeNames.has(s.name)),
      })
      catStyles.forEach((style) => {
        sendToHost({ type: 'SG_UNAPPLY', styleId: style.name })
      })
      get().detectConflicts()
      return
    }

    const selectedNames = new Set(selectedStyles.map(s => s.name))
    const toAdd = catStyles.filter(s => !selectedNames.has(s.name))
    if (toAdd.length === 0) return

    set({ selectedStyles: [...selectedStyles, ...toAdd] })
    toAdd.forEach((style) => {
      // Bulk: bump usage.last_used, but not client Recent MRU (intentional; see Recent P1/P2).
      get().incrementUsage(style.name)
      sendToHost({
        type: 'SG_APPLY',
        styleId: style.name,
        prompt: style.prompt,
        neg: style.negative_prompt,
      })
    })
    get().detectConflicts()
  },
  // Name-only key (same as Recent/Presets/selection): ★ one name ★ all CSV rows with that name.
  toggleFavorite: (name) => {
    const favs = new Set(get().favorites)
    if (favs.has(name)) favs.delete(name)
    else favs.add(name)
    localStorage.setItem('sg_v2_favorites', JSON.stringify([...favs]))
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
  isFavorite: (name) => get().favorites.has(name),
  addToRecent: (name) => {
    const recent = [name, ...get().recentNames.filter(n => n !== name)]
      .slice(0, RECENT_CAP)
    localStorage.setItem('sg_v2_recent', JSON.stringify(recent))
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
    const { selectedStyles } = get()
    const isSelected = selectedStyles.some(s => s.name === style.name)
    
    if (isSelected) {
      set({ selectedStyles: selectedStyles.filter(s => s.name !== style.name) })
      sendToHost({ type: 'SG_UNAPPLY', styleId: style.name })
      get().detectConflicts()
    } else {
      set({ selectedStyles: [...selectedStyles, style] })
      get().addToRecent(style.name)
      get().incrementUsage(style.name)
      sendToHost({ 
        type: 'SG_APPLY', 
        styleId: style.name,
        prompt: style.prompt,
        neg: style.negative_prompt,
      })
      get().detectConflicts()
    }
  },
  setSelectedStyles: (styles: Style[]) => set({ selectedStyles: styles }),
  clearAll: () => {
    const { selectedStyles } = get()
    selectedStyles.forEach(s =>
      sendToHost({ type: 'SG_UNAPPLY', styleId: s.name })
    )
    set({ selectedStyles: [], conflicts: [], activePresetName: null })
  },
  activeWildcards: [],
  setActiveWildcards: (categories) => set({ activeWildcards: categories }),
  removeWildcard: (category) => {
    set((s) => ({ activeWildcards: s.activeWildcards.filter(c => c !== category) }))
    sendToHost({ type: 'SG_REMOVE_WILDCARD', category })
  },
  showToast: (message, variant = 'info') => {
    const id = Date.now()
    set((s) => ({ toasts: [...s.toasts, { id, message, variant }] }))
    setTimeout(() => set((s) => ({
      toasts: s.toasts.filter(t => t.id !== id)
    })), 3000)
  },
  detectConflicts: () => {
    // Mirror server detect_conflicts: exact token-set intersection, not substring.
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
            reason: `${a.name} negates tags from ${b.name}`
          })
        }
        if (tokenSetsIntersect(aPos, bNeg)) {
          conflicts.push({
            styleA: b.name, styleB: a.name,
            reason: `${b.name} negates tags from ${a.name}`
          })
        }
      }
    }
    set({ conflicts })
  },
  loadUsage: async () => {
    try {
      const r = await fetch('/style_grid/usage')
      const data = await r.json()
      const counts: Record<string, number> = {}
      if (data && typeof data === 'object') {
        for (const [name, entry] of Object.entries(data)) {
          counts[name] = (entry && typeof entry === 'object' && 'count' in entry)
            ? Number((entry as { count: number }).count) || 0
            : 0
        }
      }
      set({ usageCounts: counts })
    } catch {
      // ignore usage load errors
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
  incrementUsage: (name: string) => {
    const counts = { ...get().usageCounts }
    counts[name] = (counts[name] || 0) + 1
    set({ usageCounts: counts })
    // Persist to backend
    fetch('/style_grid/usage/increment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ styles: [name] })
    }).catch(() => {})
  },
  fetchPresets: async () => {
    const parse = (raw: unknown): Record<string, { styles: string[]; created: string }> =>
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? raw as Record<string, { styles: string[]; created: string }>
        : {}
    try {
      const r = await fetch('/style_grid/presets/list')
      if (!r.ok) return
      const data = parse(await r.json())
      set({ presets: data })
    } catch {
      // ignore
    }
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
    const filtered = activeSource
      ? styles.filter(s => s.source_file === activeSource)
      : styles
    const all = [...new Set(
      filtered.map(s => s.category || 'OTHER')
    )]

    // When specific source selected — always alphabetical
    // Saved category order only applies to All Sources view
    if (activeSource) {
      return all.sort()
    }

    // Only use saved order if it was saved for All Sources context
    // (contains most of the current categories)
    const allSorted = all.sort()
    if (categoryOrder.length === 0) return allSorted

    const savedForSource = localStorage.getItem('sg_v2_category_order_source')
    if (savedForSource !== 'all' && !activeSource) {
      return allSorted
    }

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
      return allSorted
    }
    categoryOrderCoverageToastShown = false

    const rest = all.filter(c => !relevantOrder.includes(c)).sort()
    return [...relevantOrder, ...rest]
  }
}))
