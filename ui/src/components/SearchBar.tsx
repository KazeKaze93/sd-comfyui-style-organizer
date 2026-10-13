import { useId, useState, useRef } from 'react'
import type { Style } from '../bridge'
import {
  dedupeStylesByNameForAllSources,
  matchesSearch,
  styleRowKey,
  useStylesStore,
} from '../store/stylesStore'
import { useLayer } from '../lib/layerStack'
import { cn } from '../lib/utils'
import {
  Command, CommandEmpty, CommandGroup,
  CommandItem, CommandList
} from './ui/command'
import { Popover, PopoverContent, PopoverAnchor } from './ui/popover'

const SUGGESTION_LIMIT = 8
const EMPTY_SELECTED: Style[] = []

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent focus-visible:ring-offset-1 focus-visible:ring-offset-sg-bg'

/** Pure: top name matches for a query against an already-scoped style list. */
function computeSuggestions(styles: Style[], query: string): Style[] {
  if (query.length === 0) return []
  return styles.filter(s => matchesSearch(s, query)).slice(0, SUGGESTION_LIMIT)
}

export function SearchBar() {
  // Atomic selectors — full-store subscribe re-rendered on every toggle (profile P).
  const styles = useStylesStore((s) => s.styles)
  const activeSource = useStylesStore((s) => s.activeSource)
  const search = useStylesStore((s) => s.search)
  const setSearch = useStylesStore((s) => s.setSearch)
  const [open, setOpen] = useState(false)
  const [inputValue, setInputValue] = useState(search)
  /** cmdk controlled highlight (Command value / onValueChange). */
  const [highlight, setHighlight] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxId = useId()
  // When closed, return a stable empty ref so selection toggles skip this subtree.
  const selectedStyles = useStylesStore((s) => (open ? s.selectedStyles : EMPTY_SELECTED))

  // Autocomplete suggestions:
  // - specific source selected: search only in that CSV
  // - All Sources selected: search across all loaded styles
  const searchableStyles = activeSource
    ? styles.filter(s => s.source_file === activeSource)
    : dedupeStylesByNameForAllSources(styles)

  const suggestions = computeSuggestions(searchableStyles, inputValue)

  useLayer(open, () => setOpen(false))

  const handleInput = (val: string) => {
    const nextSuggestions = computeSuggestions(searchableStyles, val)
    setInputValue(val)
    setSearch(val)
    setOpen(val.length > 0 && nextSuggestions.length > 0)
    setHighlight(nextSuggestions[0]?.name ?? '')
  }

  const handleSelect = (style: Style) => {
    setOpen(false)
    setHighlight('')
    const { selectedStyles: current, toggleStyle: toggle } = useStylesStore.getState()
    const isSelected = current.some(s => styleRowKey(s) === styleRowKey(style))
    if (!isSelected) toggle(style)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative flex-1">
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-label="Search styles"
            value={inputValue}
            onChange={e => handleInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                if (open) {
                  // Layer stack owns Escape while suggestions are open:
                  // close the list only; leave query for the next Escape (App).
                  e.preventDefault()
                  e.stopPropagation()
                  setOpen(false)
                  setHighlight('')
                  return
                }
                return
              }
              if (!open || suggestions.length === 0) return

              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                const idx = suggestions.findIndex(
                  s => s.name.toLowerCase() === highlight.toLowerCase()
                )
                const cur = idx < 0 ? 0 : idx
                const next = e.key === 'ArrowDown'
                  ? (cur + 1) % suggestions.length
                  : (cur - 1 + suggestions.length) % suggestions.length
                setHighlight(suggestions[next].name)
                return
              }

              if (e.key === 'Enter') {
                e.preventDefault()
                const style = suggestions.find(
                  s => s.name.toLowerCase() === highlight.toLowerCase()
                ) ?? suggestions[0]
                handleSelect(style)
              }
            }}
            placeholder="Search styles..."
            className={cn(
              'w-full h-9 px-3 pr-8 rounded border border-sg-border bg-sg-surface text-sg-text text-sm placeholder:text-sg-muted focus:border-sg-accent focus:outline-none transition-colors',
              FOCUS_RING,
            )}
          />
          {inputValue && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setInputValue('')
                setSearch('')
                setOpen(false)
                setHighlight('')
                inputRef.current?.focus()
              }}
              className={cn(
                'absolute right-2 top-1/2 -translate-y-1/2 text-sg-muted hover:text-sg-text text-xs rounded',
                FOCUS_RING,
              )}
            >✕</button>
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent
        id={listboxId}
        role="listbox"
        className="p-0 w-72 bg-sg-popover border border-sg-border"
        align="start"
        onOpenAutoFocus={e => e.preventDefault()}
        onEscapeKeyDown={e => e.preventDefault()}
      >
        <Command
          shouldFilter={false}
          value={highlight}
          onValueChange={setHighlight}
          className="bg-transparent"
        >
          <CommandList className="bg-transparent">
            <CommandEmpty className="text-sg-muted text-sm py-3 px-4">
              No styles found
            </CommandEmpty>
            <CommandGroup>
              {suggestions.map(style => (
                <CommandItem
                  key={styleRowKey(style)}
                  value={style.name}
                  onSelect={() => handleSelect(style)}
                  className="cursor-pointer flex items-center justify-between
                             text-sg-text hover:bg-sg-accent/20
                             aria-selected:bg-sg-accent/15
                             px-3 py-2"
                >
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm truncate text-sg-text font-medium">
                      {style.name.includes('_')
                        ? style.name.split('_').slice(1).join(' ')
                        : style.name}
                    </span>
                    <span className="text-xs text-sg-muted">{style.category}</span>
                  </div>
                  {selectedStyles.some(s => styleRowKey(s) === styleRowKey(style)) && (
                    <span className="text-sg-accent text-xs ml-2 shrink-0">✓</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
