import { useStylesStore } from '../store/stylesStore'
import { StyleInfoPanel } from './StyleInfoPanel'
import { SelectedBar } from './SelectedBar'

/** Visibility only — no layout springs (toggle paint path). */
export function BottomPanel() {
  const selectedCount = useStylesStore((s) => s.selectedStyles.length)
  const wildcardCount = useStylesStore((s) => s.activeWildcards.length)
  if (selectedCount === 0 && wildcardCount === 0) return null

  return (
    <div className="border-t border-sg-border bg-sg-surface/40">
      <StyleInfoPanel />
      <SelectedBar />
    </div>
  )
}
