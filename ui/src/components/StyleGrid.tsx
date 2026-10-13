import { memo, useCallback, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { sendToHost, type Style } from '../bridge'
import { buildSliceSpec } from '../lib/wildcardSlice'
import {
  FAVORITES_VIEW,
  RECENT_VIEW,
  selectFilteredStyles,
  styleRowKey,
  useStylesStore,
} from '../store/stylesStore'
import { StyleCard } from './StyleCard'
import { WildcardCategoryMenu } from './WildcardCategoryMenu'
import { PresetList } from './PresetList'
import { autoFillGridClass, VirtualStyleGrid } from './grid'

/** Stable stubs — Favorites/Recent store churn must not invalidate All/category memos. */
const EMPTY_FAVORITES = new Set<string>()
const EMPTY_RECENT: string[] = []

function emptyCategoryLabel(cat: string): string {
  if (cat === FAVORITES_VIEW) return 'Favorites'
  if (cat === RECENT_VIEW) return 'Recent'
  return cat
}

function EmptyStylesNotice({
  search,
  activeSource,
  activeCategory,
  ignoreCategory = false,
  setSearch,
  setActiveSource,
  setCategory,
}: {
  search: string
  activeSource: string | null
  activeCategory: string | null
  ignoreCategory?: boolean
  setSearch: (q: string) => void
  setActiveSource: (src: string | null) => void
  setCategory: (cat: string | null) => void
}) {
  const hasSearch = search.trim().length > 0
  const hasSource = Boolean(activeSource)
  const hasCategory = !ignoreCategory && Boolean(activeCategory)

  const parts: string[] = []
  if (hasSearch) parts.push(`matching “${search.trim()}”`)
  if (hasSource) parts.push(`from ${activeSource}`)
  if (hasCategory && activeCategory) parts.push(`in ${emptyCategoryLabel(activeCategory)}`)

  const reason = parts.length > 0
    ? `No styles found ${parts.join(' ')}.`
    : 'No styles found.'

  const resetBtnClass =
    'text-xs px-2.5 py-1 rounded border border-sg-border text-sg-muted hover:text-sg-text hover:bg-sg-surface/60 transition-colors'

  return (
    <div className="flex flex-col items-center justify-center gap-3 h-32 text-sg-muted text-sm px-4 text-center">
      <p>{reason}</p>
      {(hasSearch || hasSource || hasCategory) && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {hasSearch && (
            <button type="button" className={resetBtnClass} onClick={() => setSearch('')}>
              Clear search
            </button>
          )}
          {hasSource && (
            <button type="button" className={resetBtnClass} onClick={() => setActiveSource(null)}>
              All sources
            </button>
          )}
          {hasCategory && (
            <button type="button" className={resetBtnClass} onClick={() => setCategory(null)}>
              All categories
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Memo: App selectedStyles must not re-run grouping.
 * Profile (toggle N=5000): always-on recentNames/favorites made addToRecent
 * rebuild selectFilteredStyles + VirtualStyleGrid on every select click.
 */
export const StyleGrid = memo(function StyleGrid({ windowed = false }: { windowed?: boolean }) {
  const {
    styles, search, activeCategory, activeSource,
    favorites, recentNames, presets,
    compactMode, collapsedCategories, toggleCollapse,
    selectAllInCategory,
    categories,
    categoryOrder,
    sliceMode, sliceSelection,
    exitSliceMode, toggleSliceSelection,
    selectAllSlice, clearSliceSelection,
    setSearch, setActiveSource, setCategory,
  } = useStylesStore(
    useShallow((s) => {
      const cat = s.activeCategory
      return {
        styles: s.styles,
        search: s.search,
        activeCategory: cat,
        activeSource: s.activeSource,
        favorites: cat === FAVORITES_VIEW ? s.favorites : EMPTY_FAVORITES,
        recentNames: cat === RECENT_VIEW ? s.recentNames : EMPTY_RECENT,
        presets: s.presets,
        compactMode: s.compactMode,
        collapsedCategories: s.collapsedCategories,
        toggleCollapse: s.toggleCollapse,
        selectAllInCategory: s.selectAllInCategory,
        categories: s.categories,
        // subscribe so sidebar reorder re-renders group order
        categoryOrder: s.categoryOrder,
        sliceMode: s.sliceMode,
        sliceSelection: s.sliceSelection,
        exitSliceMode: s.exitSliceMode,
        toggleSliceSelection: s.toggleSliceSelection,
        selectAllSlice: s.selectAllSlice,
        clearSliceSelection: s.clearSliceSelection,
        setSearch: s.setSearch,
        setActiveSource: s.setActiveSource,
        setCategory: s.setCategory,
      }
    }),
  )
  const [catMenu, setCatMenu] = useState<{
    x: number
    y: number
    cat: string
    restoreFocusTo: HTMLElement | null
  } | null>(null)

  const filtered = useMemo(
    () => selectFilteredStyles(styles, search, activeCategory, activeSource, favorites, recentNames, presets),
    [styles, search, activeCategory, activeSource, favorites, recentNames, presets]
  )

  const sliceCategory = sliceMode?.category ?? null

  /** Search/source-filtered styles for slice mode — ignores sidebar activeCategory. */
  const sliceFiltered = useMemo(
    () =>
      sliceCategory
        ? selectFilteredStyles(styles, search, null, activeSource, favorites, recentNames, presets)
        : ([] as Style[]),
    [sliceCategory, styles, search, activeSource, favorites, recentNames, presets],
  )

  /** Currently visible (search/filter-applied) cards for the slice category. */
  const visibleSliceStyles = useMemo(() => {
    if (!sliceCategory) return [] as Style[]
    const want = sliceCategory.toLowerCase()
    return sliceFiltered.filter((s) => (s.category || 'OTHER').toLowerCase() === want)
  }, [sliceFiltered, sliceCategory])

  /** Unfiltered category total for the compactor (source-scoped, not search-scoped). */
  const allNamesInCategory = useMemo(() => {
    if (!sliceCategory) return [] as string[]
    const want = sliceCategory.toLowerCase()
    return styles
      .filter((s) => {
        if ((s.category || 'OTHER').toLowerCase() !== want) return false
        if (activeSource && s.source_file !== activeSource) return false
        return true
      })
      .map((s) => s.name)
  }, [styles, sliceCategory, activeSource])

  const gridClass = autoFillGridClass(compactMode, windowed)
  const scrollResetKey = `${search}\0${activeCategory ?? ''}\0${activeSource ?? ''}`

  // All-categories grouping (hooks before early returns). categoryOrder is a
  // categories() dep not covered by filtered (profile: avoid O(N) on toggle).
  const sortedGroups = useMemo(() => {
    const groups = filtered.reduce((acc, style) => {
      const cat = style.category || 'OTHER'
      if (!acc[cat]) acc[cat] = []
      acc[cat].push(style)
      return acc
    }, {} as Record<string, Style[]>)

    const catOrder = categories()
    return [
      ...catOrder
        .filter(cat => groups[cat])
        .map(cat => [cat, groups[cat]] as [string, Style[]]),
      ...Object.keys(groups)
        .filter(cat => !catOrder.includes(cat))
        .sort()
        .map(cat => [cat, groups[cat]] as [string, Style[]]),
    ]
    // categoryOrder is read inside categories(); filtered does not cover reorder.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional categories() dep
  }, [filtered, categories, categoryOrder])

  const handleHeaderContextMenu = useCallback(
    (cat: string, x: number, y: number, restoreFocusTo: HTMLElement) =>
      setCatMenu({ x, y, cat, restoreFocusTo }),
    [],
  )

  /** Flat single-group view — stable identity so VirtualStyleGrid skips row rebuilds. */
  const flatCategoryGroups = useMemo((): Array<[string, Style[]]> => {
    if (!activeCategory || activeCategory === 'presets') return []
    return [[activeCategory, filtered]]
  }, [activeCategory, filtered])

  const renderSliceCard = (style: Style) => {
    const checked = sliceSelection.includes(style.name)
    const label = style.name.includes('_')
      ? style.name.split('_').slice(1).join(' ')
      : style.name
    return (
      <div key={styleRowKey(style)} className="relative">
        <StyleCard style={style} windowed={windowed} />
        <button
          type="button"
          className={`absolute inset-0 z-20 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent ${
            checked ? 'bg-sg-wildcard/15 ring-1 ring-sg-wildcard/50' : 'bg-transparent'
          }`}
          aria-pressed={checked}
          aria-label={`${checked ? 'Deselect' : 'Select'} ${label} for wildcard slice`}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            toggleSliceSelection(style.name)
          }}
        >
          <span className="absolute top-1.5 right-1.5 flex items-center justify-center">
            <input
              type="checkbox"
              checked={checked}
              readOnly
              tabIndex={-1}
              aria-hidden
              className="pointer-events-none h-4 w-4 accent-sg-wildcard"
            />
          </span>
        </button>
      </div>
    )
  }

  const renderSliceModeBar = () => {
    if (!sliceMode) return null
    const cat = sliceMode.category
    return (
      <div
        role="toolbar"
        aria-label={`Wildcard slice selection for ${cat}`}
        className="flex flex-wrap items-center gap-2 px-1 py-2 mb-2 rounded-md
                   border border-sg-wildcard/40 bg-sg-wildcard/10"
      >
        <span className="text-sm text-sg-text font-medium">
          Slice: <span className="text-sg-wildcard-text">{cat}</span>
        </span>
        <span className="text-xs text-sg-muted" aria-live="polite">
          {sliceSelection.length} selected
        </span>
        <div className="flex-1" />
        <button
          type="button"
          aria-label="Select all visible styles for wildcard slice"
          className="text-xs px-2 py-1 rounded text-sg-muted hover:text-sg-text
                     hover:bg-sg-surface/60 transition-colors"
          onClick={() => selectAllSlice(visibleSliceStyles.map((s) => s.name))}
        >
          Select all
        </button>
        <button
          type="button"
          aria-label="Clear wildcard slice selection"
          className="text-xs px-2 py-1 rounded text-sg-muted hover:text-sg-text
                     hover:bg-sg-surface/60 transition-colors"
          onClick={() => clearSliceSelection()}
        >
          Clear all
        </button>
        <button
          type="button"
          aria-label="Add selection as wildcard slice"
          className="text-xs px-2.5 py-1 rounded bg-sg-wildcard/30 border border-sg-wildcard/50
                     text-sg-text hover:bg-sg-wildcard/45 transition-colors font-medium"
          onClick={() => {
            const spec = buildSliceSpec(cat, sliceSelection, allNamesInCategory)
            sendToHost({ type: 'SG_WILDCARD_SLICE', category: cat, spec })
            exitSliceMode()
          }}
        >
          Add as wildcard
        </button>
        <button
          type="button"
          aria-label="Cancel wildcard slice selection"
          className="text-xs px-2 py-1 rounded text-sg-muted hover:text-sg-text
                     hover:bg-sg-surface/60 transition-colors"
          onClick={() => exitSliceMode()}
        >
          Cancel
        </button>
      </div>
    )
  }

  // Slice-selection mode: NOT virtualized (contract).
  if (sliceMode) {
    return (
      <div className="space-y-2">
        {renderSliceModeBar()}
        {visibleSliceStyles.length === 0 ? (
          <EmptyStylesNotice
            search={search}
            activeSource={activeSource}
            activeCategory={activeCategory}
            ignoreCategory
            setSearch={setSearch}
            setActiveSource={setActiveSource}
            setCategory={setCategory}
          />
        ) : (
          <div className={gridClass}>
            {visibleSliceStyles.map(renderSliceCard)}
          </div>
        )}
      </div>
    )
  }

  if (activeCategory === 'presets') {
    return <PresetList />
  }

  if (filtered.length === 0) {
    return (
      <EmptyStylesNotice
        search={search}
        activeSource={activeSource}
        activeCategory={activeCategory}
        setSearch={setSearch}
        setActiveSource={setActiveSource}
        setCategory={setCategory}
      />
    )
  }

  // Specific category / Favorites / Recent — flat virtualized grid, no section headers.
  if (activeCategory) {
    return (
      <VirtualStyleGrid
        groups={flatCategoryGroups}
        collapsedCategories={collapsedCategories}
        compactMode={compactMode}
        windowed={windowed}
        includeHeaders={false}
        scrollResetKey={scrollResetKey}
        onToggleCollapse={toggleCollapse}
        onSelectAll={selectAllInCategory}
      />
    )
  }

  return (
    <VirtualStyleGrid
      groups={sortedGroups}
      collapsedCategories={collapsedCategories}
      compactMode={compactMode}
      windowed={windowed}
      includeHeaders
      scrollResetKey={scrollResetKey}
      onToggleCollapse={toggleCollapse}
      onSelectAll={selectAllInCategory}
      onHeaderContextMenu={handleHeaderContextMenu}
    >
      {catMenu && (
        <WildcardCategoryMenu
          category={catMenu.cat}
          x={catMenu.x}
          y={catMenu.y}
          onClose={() => setCatMenu(null)}
          restoreFocusTo={catMenu.restoreFocusTo}
        />
      )}
    </VirtualStyleGrid>
  )
})
