import { memo, startTransition, useEffect, useRef, useState, type MouseEvent } from 'react'
import { Reorder } from 'framer-motion'
import { BookMarked, Clock, Star } from 'lucide-react'
import {
  FAVORITES_VIEW,
  RECENT_VIEW,
  filterFavoriteStyles,
  selectFilteredStyles,
  useCategoryColor,
  useStylesStore,
} from '../store/stylesStore'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '../lib/utils'
import { MenuItem, ViewportFixedMenu } from './ViewportFixedMenu'
import { WildcardCategoryMenu } from './WildcardCategoryMenu'

const NAV_FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent focus-visible:ring-offset-1 focus-visible:ring-offset-sg-bg'

function CategoryName({ category }: { category: string }) {
  const color = useCategoryColor(category)
  return (
    <span className="flex-1 truncate" style={{ color }}>
      {category}
    </span>
  )
}

/** Isolated: toggle → addToRecent must not re-render category Reorder (profile P). */
const RecentNavButton = memo(function RecentNavButton({
  active,
  onActivate,
  onContextMenu,
}: {
  active: boolean
  onActivate: () => void
  onContextMenu: (e: MouseEvent<HTMLButtonElement>) => void
}) {
  const {
    styles, search, activeSource, favorites, recentNames, presets,
  } = useStylesStore(
    useShallow((s) => ({
      styles: s.styles,
      search: s.search,
      activeSource: s.activeSource,
      favorites: s.favorites,
      recentNames: s.recentNames,
      presets: s.presets,
    })),
  )
  const count = selectFilteredStyles(
    styles, search, RECENT_VIEW, activeSource, favorites, recentNames, presets,
  ).length
  return (
    <button
      type="button"
      onClick={onActivate}
      onContextMenu={onContextMenu}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'w-full flex items-center justify-between gap-2 text-left px-3 py-2 rounded-md text-sm transition-colors cursor-context-menu',
        NAV_FOCUS_RING,
        active
          ? 'bg-sg-accent text-white'
          : 'text-sg-muted hover:text-sg-text hover:bg-sg-surface',
        count === 0 ? 'opacity-40' : '',
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Clock className="h-4 w-4 shrink-0" aria-hidden />
        <span className="truncate">Recent</span>
      </span>
      <span className="text-xs opacity-60 shrink-0">{count}</span>
    </button>
  )
})

/** Memo: App selectedStyles updates must not re-run Reorder (profile P). */
export const Sidebar = memo(function Sidebar() {
  const {
    activeCategory, setCategory, categories, favorites,
    setCategoryOrder, presets, styles, activeSource, search,
    clearFavorites, clearRecent,
  } = useStylesStore(
    useShallow(s => ({
      activeCategory: s.activeCategory,
      setCategory: s.setCategory,
      categories: s.categories,
      favorites: s.favorites,
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
  const allColor = useCategoryColor('All')
  const [catMenu, setCatMenu] = useState<{
    x: number
    y: number
    cat: string
    restore: HTMLElement
  } | null>(null)
  const [favMenu, setFavMenu] = useState<{
    x: number
    y: number
    restore: HTMLElement
  } | null>(null)
  const [recentMenu, setRecentMenu] = useState<{
    x: number
    y: number
    restore: HTMLElement
  } | null>(null)
  // Local order while dragging; persist only on Reorder.Item onDragEnd.
  const [dragOrder, setDragOrder] = useState<string[] | null>(null)
  const dragOrderRef = useRef<string[] | null>(null)
  const cats = dragOrder ?? categories()
  const favCount = filterFavoriteStyles(styles, search, activeSource, favorites).length

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
        onClick={() => startTransition(() => setCategory(null))}
        aria-current={!activeCategory ? 'true' : undefined}
        className={cn(
          'w-full flex items-center justify-between gap-2 text-left px-3 py-2 rounded-md text-sm transition-colors',
          NAV_FOCUS_RING,
          !activeCategory
            ? 'bg-sg-accent text-white'
            : 'text-sg-muted hover:text-sg-text hover:bg-sg-surface',
        )}
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="truncate" style={{ color: allColor }}>All</span>
        </span>
        <span className="text-xs opacity-60 shrink-0">
          {count(null)}
        </span>
      </button>
      <button
        type="button"
        onClick={() => startTransition(() => setCategory(activeCategory === FAVORITES_VIEW ? null : FAVORITES_VIEW))}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setFavMenu({
            x: e.clientX,
            y: e.clientY,
            restore: e.currentTarget,
          })
        }}
        aria-current={activeCategory === FAVORITES_VIEW ? 'true' : undefined}
        className={cn(
          'w-full flex items-center justify-between gap-2 text-left px-3 py-2 rounded-md text-sm transition-colors cursor-context-menu',
          NAV_FOCUS_RING,
          activeCategory === FAVORITES_VIEW
            ? 'bg-sg-accent text-white'
            : 'text-sg-muted hover:text-sg-text hover:bg-sg-surface',
          favCount === 0 ? 'opacity-40' : '',
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Star className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">Favorites</span>
        </span>
        <span className="text-xs opacity-60 shrink-0">{favCount}</span>
      </button>
      <RecentNavButton
        active={activeCategory === RECENT_VIEW}
        onActivate={() => startTransition(() => setCategory(activeCategory === RECENT_VIEW ? null : RECENT_VIEW))}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setRecentMenu({
            x: e.clientX,
            y: e.clientY,
            restore: e.currentTarget,
          })
        }}
      />
      <button
        type="button"
        onClick={() => startTransition(() => setCategory(activeCategory === 'presets' ? null : 'presets'))}
        aria-current={activeCategory === 'presets' ? 'true' : undefined}
        className={cn(
          'w-full flex items-center justify-between gap-2 text-left px-3 py-2 rounded-md text-sm transition-colors',
          NAV_FOCUS_RING,
          activeCategory === 'presets'
            ? 'bg-sg-accent text-white'
            : 'text-sg-muted hover:text-sg-text hover:bg-sg-surface',
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <BookMarked className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">Presets</span>
        </span>
        <span className="shrink-0 text-xs opacity-60 tabular-nums">
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
                onClick={() => startTransition(() => setCategory(activeCategory === cat ? null : cat))}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setCatMenu({
                    x: e.clientX,
                    y: e.clientY,
                    cat,
                    restore: e.currentTarget,
                  })
                }}
                aria-current={isActive ? 'true' : undefined}
                className={cn(
                  'w-full text-left px-3 py-2 rounded-md text-sm transition-colors cursor-context-menu',
                  NAV_FOCUS_RING,
                  isActive
                    ? 'bg-sg-accent text-white'
                    : 'text-sg-muted hover:text-sg-text hover:bg-sg-surface',
                )}
              >
                <span className="flex items-center gap-2">
                  <CategoryName category={cat} />
                  <span className="text-xs opacity-60 shrink-0">{count(cat)}</span>
                </span>
              </button>
            </Reorder.Item>
          )
        })}
      </Reorder.Group>
      {favMenu && (
        <ViewportFixedMenu
          x={favMenu.x}
          y={favMenu.y}
          onClose={() => setFavMenu(null)}
          restoreFocusTo={favMenu.restore}
        >
          <MenuItem
            onSelect={() => {
              clearFavorites()
              setFavMenu(null)
            }}
          >
            Clear Favorites
          </MenuItem>
        </ViewportFixedMenu>
      )}
      {recentMenu && (
        <ViewportFixedMenu
          x={recentMenu.x}
          y={recentMenu.y}
          onClose={() => setRecentMenu(null)}
          restoreFocusTo={recentMenu.restore}
        >
          <MenuItem
            onSelect={() => {
              clearRecent()
              setRecentMenu(null)
            }}
          >
            Clear Recent
          </MenuItem>
        </ViewportFixedMenu>
      )}
      {catMenu && (
        <WildcardCategoryMenu
          category={catMenu.cat}
          x={catMenu.x}
          y={catMenu.y}
          onClose={() => setCatMenu(null)}
          restoreFocusTo={catMenu.restore}
        />
      )}
    </div>
  )
})
