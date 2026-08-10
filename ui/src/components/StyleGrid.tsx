import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useShallow } from 'zustand/react/shallow'
import { type Style } from '../bridge'
import {
  getCategoryColor,
  selectFilteredStyles,
  styleRowKey,
  useStylesStore,
} from '../store/stylesStore'
import { StyleCard } from './StyleCard'
import { WildcardCategoryMenu } from './WildcardCategoryMenu'

export function StyleGrid({ windowed = false }: { windowed?: boolean }) {
  const {
    styles, search, activeCategory, activeSource,
    favorites, recentNames, presets,
    compactMode, collapsedCategories, toggleCollapse,
    selectedStyles, selectAllInCategory,
    categories,
  } = useStylesStore(
    useShallow(s => ({
      styles: s.styles,
      search: s.search,
      activeCategory: s.activeCategory,
      activeSource: s.activeSource,
      favorites: s.favorites,
      recentNames: s.recentNames,
      presets: s.presets,
      compactMode: s.compactMode,
      collapsedCategories: s.collapsedCategories,
      toggleCollapse: s.toggleCollapse,
      selectedStyles: s.selectedStyles,
      selectAllInCategory: s.selectAllInCategory,
      categories: s.categories,
      // subscribe so sidebar reorder re-renders group order
      categoryOrder: s.categoryOrder,
    }))
  )
  const [catMenu, setCatMenu] = useState<{
    x: number
    y: number
    cat: string
    missingCount: number
  } | null>(null)

  const filtered = useMemo(
    () => selectFilteredStyles(styles, search, activeCategory, activeSource, favorites, recentNames, presets),
    [styles, search, activeCategory, activeSource, favorites, recentNames, presets]
  )

  if (activeCategory === 'presets') {
    const presetNames = Object.keys(presets).sort((a, b) => a.localeCompare(b))
    if (presetNames.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
          <p className="text-sg-muted text-sm">No presets saved yet</p>
          <p className="max-w-sm text-sg-muted/70 text-xs leading-relaxed">
            Open the toolbar <span className="text-sg-text/90">Presets</span> control, then use{' '}
            <span className="text-sg-text/90">Save current</span> in the Style Presets dialog.
          </p>
        </div>
      )
    }
    return (
      <div
        className={`grid content-start ${
          compactMode
            ? windowed
              ? 'grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-1'
              : 'grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-1'
            : windowed
              ? 'grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-1'
              : 'grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2'
        }`}
      >
        {presetNames.map((name) => {
          const style: Style = {
            name,
            prompt: '',
            negative_prompt: '',
            description: '',
            category: 'OTHER',
            source_file: '',
            has_thumbnail: false,
            read_only: false,
          }
          return (
            <StyleCard
              key={`preset:${name}`}
              style={style}
              windowed={windowed}
              presetName={name}
            />
          )
        })}
      </div>
    )
  }

  if (filtered.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 
                      text-sg-muted text-sm">
        No styles found
      </div>
    )
  }

  // Specific category / Favorites / Recent — flat grid, no section headers.
  // (presets already returned above; All/null falls through to grouped view)
  if (activeCategory) {
    return (
      <div className={`grid content-start ${
        compactMode
          ? (windowed
              ? 'grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-1'
              : 'grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-1')
          : (windowed
              ? 'grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-1'
              : 'grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2')
      }`} style={{ contentVisibility: 'auto' }}>
        {filtered.map(style => (
          <StyleCard key={styleRowKey(style)} style={style} windowed={windowed} />
        ))}
      </div>
    )
  }

  // Group by category for All view
  const groups = filtered.reduce((acc, style) => {
    const cat = style.category || 'OTHER'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(style)
    return acc
  }, {} as Record<string, typeof filtered>)

  // Same order as Sidebar via store.categories(); leftover keys (e.g. OTHER) append sorted.
  const catOrder = categories()
  const sortedGroups: [string, typeof filtered][] = [
    ...catOrder
      .filter(cat => groups[cat])
      .map(cat => [cat, groups[cat]] as [string, typeof filtered]),
    ...Object.keys(groups)
      .filter(cat => !catOrder.includes(cat))
      .sort()
      .map(cat => [cat, groups[cat]] as [string, typeof filtered]),
  ]

  return (
    <div className="space-y-4">
      {sortedGroups.map(([cat, catStyles]) => {
        const isCollapsed = collapsedCategories.has(cat)
        const color = getCategoryColor(cat)
        const allSelected = catStyles.every(s =>
          selectedStyles.some(sel => sel.name === s.name)
        )

        return (
          <div key={cat}>
            {/* Category header */}
            <div
              className="flex items-center gap-2 mb-2 sticky top-0 
                            bg-sg-bg/95 backdrop-blur-sm py-1 z-10 cursor-pointer hover:bg-sg-surface/30 rounded-md transition-colors -mx-1 px-1"
              title="Right-click for options"
              onClick={() => toggleCollapse(cat)}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const missing = catStyles.filter(s =>
                  !localStorage.getItem(`sg_thumb_v_${s.name}`)
                ).length
                setCatMenu({ x: e.clientX, y: e.clientY, cat, missingCount: missing })
              }}
            >
              <span className="text-sg-muted">
                {isCollapsed ? '▶' : '▼'}
              </span>
              <span
                className="text-xs font-bold tracking-wider uppercase"
                style={{ color }}
              >
                {cat}
              </span>
              <span className="text-xs text-sg-muted/60">
                ({catStyles.length})
              </span>
              <div className="flex-1" />
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  selectAllInCategory(cat)
                }}
                className="text-xs text-sg-muted hover:text-sg-accent 
                           transition-colors px-2 py-0.5 rounded
                           hover:bg-sg-accent/10"
              >
                {allSelected ? 'Deselect All' : 'Select All'}
              </button>
            </div>

            {/* Cards */}
            <AnimatePresence>
              {!isCollapsed && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="overflow-hidden"
                >
                  <div className={`grid ${
                    compactMode
                      ? (windowed
                          ? 'grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-1'
                          : 'grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-1')
                      : (windowed
                          ? 'grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-1'
                          : 'grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2')
                  }`} style={{ contentVisibility: 'auto' }}>
                    {catStyles.map(style => (
                      <StyleCard key={styleRowKey(style)} style={style} windowed={windowed} />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )
      })}
      {catMenu && (
        <WildcardCategoryMenu
          category={catMenu.cat}
          x={catMenu.x}
          y={catMenu.y}
          onClose={() => setCatMenu(null)}
        />
      )}
    </div>
  )
}
