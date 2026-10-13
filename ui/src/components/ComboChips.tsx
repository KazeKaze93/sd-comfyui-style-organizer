import { startTransition } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStylesStore, styleRowKey } from '../store/stylesStore'
import { resolveCombosInSourceFile } from '../lib/styleIdentity'
import type { Style } from '../bridge'

interface Props {
  style: Pick<Style, 'name' | 'description' | 'source_file'>
  onBeforeToggle?: () => void
}

function chipLabel(token: string): string {
  return token.includes('_') ? token.split('_').slice(1).join(' ') : token
}

export function ComboChips({ style, onBeforeToggle }: Props) {
  const { styles, setCategory, toggleStyle, selectedStyles } = useStylesStore(
    useShallow((s) => ({
      styles: s.styles,
      setCategory: s.setCategory,
      toggleStyle: s.toggleStyle,
      selectedStyles: s.selectedStyles,
    })),
  )

  if (!style.description) return null

  const resolvedCombos = resolveCombosInSourceFile(
    style.description,
    styles,
    style.source_file,
  )

  if (resolvedCombos.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      <span className="text-xs text-sg-muted self-center">Works with:</span>
      {resolvedCombos.map((resolved, index) => {
        if (resolved.type === 'style') {
          const isSelected = selectedStyles.some(
            (s) => styleRowKey(s) === styleRowKey(resolved.style),
          )
          const token = resolved.token
          const title = resolved.comment
            || `Click to ${isSelected ? 'deselect' : 'select'} ${token}`
          return (
            <button
              key={`s:${token}:${resolved.comment}:${index}`}
              onClick={() => {
                onBeforeToggle?.()
                toggleStyle(resolved.style)
              }}
              className={`px-2 py-0.5 rounded text-xs border transition-colors
                ${isSelected
                  ? 'bg-sg-accent/30 border-sg-accent/60 text-sg-text'
                  : 'bg-sg-accent/10 border-sg-accent/30 text-sg-text hover:bg-sg-accent/20'}`}
              title={title}
            >
              {isSelected ? '✓ ' : ''}{chipLabel(token)}
            </button>
          )
        }

        if (resolved.type === 'category') {
          const title = resolved.comment || `Filter by category ${resolved.category}`
          return (
            <button
              key={`c:${resolved.token}:${resolved.comment}:${index}`}
              onClick={() => startTransition(() => setCategory(resolved.category))}
              className="px-2 py-0.5 rounded text-xs border transition-colors
                bg-sg-warning/10 border-sg-warning/30 text-sg-warning-text
                hover:bg-sg-warning/20"
              title={title}
            >
              {resolved.token}
            </button>
          )
        }

        return (
          <span
            key={`r:${resolved.token}:${index}`}
            className="px-2 py-0.5 rounded text-xs border
              bg-sg-warning/10 border-sg-warning/30 text-sg-warning-text"
            title={resolved.token}
          >
            {resolved.token}
          </span>
        )
      })}
    </div>
  )
}
