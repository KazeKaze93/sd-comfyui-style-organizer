import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Reorder } from 'framer-motion'
import { BookMarked } from 'lucide-react'
import {
  FAVORITES_VIEW,
  RECENT_VIEW,
  filterFavoriteStyles,
  getCategoryColor,
  selectFilteredStyles,
  useStylesStore,
} from '../store/stylesStore'
import { useShallow } from 'zustand/react/shallow'
import { WildcardCategoryMenu } from './WildcardCategoryMenu'

export function Sidebar() {
  const {
    activeCategory, setCategory, categories, favorites, recentNames,
    setCategoryOrder, presets, styles, activeSource, search,
    clearFavorites, clearRecent,
  } = useStylesStore(
    useShallow(s => ({
      activeCategory: s.activeCategory,
      setCategory: s.setCategory,
      categories: s.categories,
      favorites: s.favorites,
      recentNames: s.recentNames,
      setCategoryOrder: s.setCategoryOrder,
      presets: s.presets,
      clearFavorites: s.clearFavorites,
      clearRecent: s.clearRecent,
      // categories() deps — subscribe so list/order refresh without App re-renders
      styles: s.styles,
      activeSource: s.activeSource,
      categoryOrder: s.categoryOrder,
      search: s.search,
    }))
  )
  const [catMenu, setCatMenu] = useState<{
    x: number
    y: number
    cat: string
  } | null>(null)
  const [favMenu, setFavMenu] = useState<{ x: number; y: number } | null>(null)
  const [recentMenu, setRecentMenu] = useState<{ x: number; y: number } | null>(null)
  // Local order while dragging; persist only on Reorder.Item onDragEnd.
  const [dragOrder, setDragOrder] = useState<string[] | null>(null)
  const dragOrderRef = useRef<string[] | null>(null)
  const cats = dragOrder ?? categories()
  const specialCategories = [
    {
      id: FAVORITES_VIEW,
      label: FAVORITES_VIEW,
      count: filterFavoriteStyles(styles, search, activeSource, favorites).length,
    },
    {
      id: RECENT_VIEW,
      label: RECENT_VIEW,
      count: selectFilteredStyles(
        styles, search, RECENT_VIEW, activeSource, favorites, recentNames, presets,
      ).length,
    },
  ]

  useEffect(() => {
    void useStylesStore.getState().fetchPresets()
  }, [])

  const count = (cat: string | null) => {
    const { styles, activeSource } = useStylesStore.getState()
    const src = activeSource
      ? styles.filter(s => s.source_file === activeSource)
      : styles
    return cat
      ? src.filter(s => (s.category || 'OTHER') === cat).length
      : src.length
  }

  const commitDragOrder = () => {
    const next = dragOrderRef.current
    dragOrderRef.current = null
    setDragOrder(null)
    if (next) setCategoryOrder(next)
  }

  return (
    <div className="w-44 shrink-0 flex flex-col gap-1 pr-2">
      <button
        type="button"
        onClick={() => setCategory(null)}
        className={`w-full flex items-center justify-between gap-2 text-left px-3 py-2 rounded-md text-sm transition-colors relative overflow-hidden
          ${!activeCategory
            ? 'text-white'
            : 'text-sg-muted hover:text-sg-text hover:bg-sg-surface'}`}
      >
        {!activeCategory && (
          <motion.div
            layoutId="active-category"
            className="absolute inset-0 bg-sg-accent rounded-md -z-10"
            transition={{ type: 'spring', bounce: 0.2, duration: 0.3 }}
          />
        )}
        <span className="relative z-10 flex items-center gap-2 min-w-0">
          <span className="truncate" style={{ color: getCategoryColor('All') }}>All</span>
        </span>
        <span className="relative z-10 text-xs opacity-60 shrink-0">
          {count(null)}
        </span>
      </button>
      {specialCategories.map(({ id, label, count }) => (
        <button
          key={id}
          type="button"
          onClick={() => setCategory(activeCategory === id ? null : id)}
          onContextMenu={
            id === FAVORITES_VIEW ? (e) => {
              e.preventDefault()
              e.stopPropagation()
              setFavMenu({ x: e.clientX, y: e.clientY })
            }
            : id === RECENT_VIEW ? (e) => {
              e.preventDefault()
              e.stopPropagation()
              setRecentMenu({ x: e.clientX, y: e.clientY })
            }
            : undefined
          }
          className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors
      ${activeCategory === id
        ? 'bg-sg-accent text-white'
        : 'text-sg-muted hover:text-sg-text hover:bg-sg-surface'}
      ${id === FAVORITES_VIEW || id === RECENT_VIEW ? 'cursor-context-menu' : ''}
      ${count === 0 ? 'opacity-40' : ''}`}
        >
          {label}
          <span className="ml-auto float-right text-xs opacity-60">{count}</span>
        </button>
      ))}
      <button
        type="button"
        onClick={() => setCategory(activeCategory === 'presets' ? null : 'presets')}
        className={`w-full flex items-center justify-between gap-2 text-left px-3 py-2 rounded-md text-sm transition-colors relative overflow-hidden
          ${activeCategory === 'presets'
            ? 'text-white'
            : 'text-sg-muted hover:text-sg-text hover:bg-sg-surface'}`}
      >
        {activeCategory === 'presets' && (
          <motion.div
            layoutId="active-category"
            className="absolute inset-0 bg-sg-accent rounded-md -z-10"
            transition={{ type: 'spring', bounce: 0.2, duration: 0.3 }}
          />
        )}
        <span className="relative z-10 flex min-w-0 items-center gap-2">
          <BookMarked className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">Presets</span>
        </span>
        <span className="relative z-10 shrink-0 text-xs opacity-60 tabular-nums">
          {Object.keys(presets).length}
        </span>
      </button>
      <div className="border-t border-sg-border my-1" />
      <Reorder.Group
        axis="y"
        values={cats}
        onReorder={(newOrder) => {
          dragOrderRef.current = newOrder
          setDragOrder(newOrder)
        }}
        as="div"
        className="flex flex-col gap-1"
      >
        {cats.map(cat => {
          const isActive = activeCategory === cat
          return (
            <Reorder.Item
              key={cat}
              value={cat}
              as="div"
              whileDrag={{ scale: 1.02, opacity: 0.9 }}
              className="cursor-grab active:cursor-grabbing"
              onDragEnd={commitDragOrder}
            >
              <button
                type="button"
                onClick={() => setCategory(activeCategory === cat ? null : cat)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setCatMenu({ x: e.clientX, y: e.clientY, cat })
                }}
                className={`w-full text-left px-3 py-2 rounded-md text-sm 
                    transition-colors cursor-context-menu relative overflow-hidden
                  ${isActive
                    ? 'bg-sg-accent text-white'
                    : 'text-sg-muted hover:text-sg-text hover:bg-sg-surface'}`}
              >
                {isActive && (
                  <motion.div
                    layoutId="active-category"
                    className="absolute inset-0 bg-sg-accent rounded-md -z-10"
                    transition={{ type: 'spring', bounce: 0.2, duration: 0.3 }}
                  />
                )}
                <span className="flex items-center gap-2 relative z-10">
                  <span className="flex-1 truncate" style={{ color: getCategoryColor(cat) }}>
                    {cat}
                  </span>
                  <span className="text-xs opacity-60 shrink-0">{count(cat)}</span>
                </span>
              </button>
            </Reorder.Item>
          )
        })}
      </Reorder.Group>
      {favMenu && (
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setFavMenu(null)} />
          <div
            className="fixed z-[9999] bg-[#0f172a] border border-sg-border rounded-lg shadow-xl py-1 min-w-52"
            style={{ left: favMenu.x, top: favMenu.y }}
          >
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 text-sm text-white hover:bg-sg-accent/20 transition-colors"
              onClick={() => {
                clearFavorites()
                setFavMenu(null)
              }}
            >
              Clear Favorites
            </button>
          </div>
        </>
      )}
      {recentMenu && (
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setRecentMenu(null)} />
          <div
            className="fixed z-[9999] bg-[#0f172a] border border-sg-border rounded-lg shadow-xl py-1 min-w-52"
            style={{ left: recentMenu.x, top: recentMenu.y }}
          >
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 text-sm text-white hover:bg-sg-accent/20 transition-colors"
              onClick={() => {
                clearRecent()
                setRecentMenu(null)
              }}
            >
              Clear Recent
            </button>
          </div>
        </>
      )}
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
