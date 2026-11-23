/**
 * Checklist: every ComfyUI-only item that had to survive the convergence onto
 * the WebUI ui/src tree (port batch 3, Phase 0 plan, section 1) is in this tree.
 * Each row: [item, file relative to ui/, symbols that must appear in it].
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => fs.readFileSync(path.resolve(UI, rel), 'utf8')

const CHECKLIST: Array<[string, string, string[]]> = [
  ['deck protocol: host and frame messages', 'src/bridge.ts', ["'SG_DECK_STATE'", "'SG_DECK_RESTART'", "'SG_DECK_NEW'"]],
  ['deck protocol: SG_DECK_STATE to the store', 'src/App.tsx', ["msg.type === 'SG_DECK_STATE' && PLATFORM.deck", 'setDeckState']],
  ['deck protocol: store slice', 'src/store/stylesStore.ts', ['deckState: DeckState | null', 'setDeckState: (deckState) =>']],
  ['DeckStrip component', 'src/components/DeckStrip.tsx', ['export function DeckStrip', "type: 'SG_DECK_RESTART'", "type: 'SG_DECK_NEW'"]],
  ['DeckStrip in the SelectedBar', 'src/components/SelectedBar.tsx', ['{PLATFORM.deck && <DeckStrip />}']],
  ['deckState helper', 'src/lib/deckState.ts', ['export function hasDeckWildcard', 'export type DeckState']],
  ['chipStyles', 'src/lib/chipStyles.ts', ['CHIP_FOCUS_RING']],
  ['deck labels', 'src/lib/deckLabels.ts', ['DECK_STRIP_ARIA', 'DECK_RESTART', 'DECK_NEW']],
  ['queue-run wording', 'src/lib/platform.ts', ["shuffleScopeLabel: 'queue run'", 'between queue runs', 'one step per queue run']],
  ['queue-run wording in the labels', 'src/lib/wildcardLabels.ts', ['PLATFORM.shuffleMenuSub', 'PLATFORM.shuffleChipScope']],
  ['tagIdentity', 'src/lib/tagIdentity.ts', ['export function tagKeySet', 'export function tagKey']],
  ['tagIdentity parity test', 'src/lib/tagIdentity.parity.test.ts', ['tag_identity.json']],
  ['tagIdentity fixture', '../tests/fixtures/tag_identity.json', ['']],
  ['conflict key hook', 'src/lib/platform.ts', ['conflictKeySet: tagKeySet']],
  ['conflict key used by detectConflicts', 'src/store/stylesStore.ts', ['const tokenize = PLATFORM.conflictKeySet']],
  ['SG_UNAPPLY with an optional source_file', 'src/bridge.ts', ["{ type: 'SG_UNAPPLY';       styleId: string; source_file?: string }"]],
  ['reapply after edit', 'src/components/StyleEditorDialog.tsx', ['PLATFORM.reapplyEditedStyles', "type: 'SG_UNAPPLY'", "type: 'SG_APPLY'"]],
  ['frameElement fullscreen', 'src/lib/frameFullscreen.ts', ['export function setFrameFullscreen', 'window.frameElement', "'sg_windowed_size'"]],
  ['frameElement fullscreen wired', 'src/App.tsx', ["PLATFORM.fullscreenMode === 'frame-element'", 'setFrameFullscreen(']],
  ['source id prefixes', 'src/lib/styleIdentity.ts', ['PLATFORM.sourceIdPrefixes.includes(parts[0])']],
  ['source id prefixes: values', 'src/lib/platform.ts', ["sourceIdPrefixes: ['data', 'imports', 'samples']"]],
  ['samples copy to data/', 'src/lib/styleActions.ts', ['export function samplesCopyTarget', 'export function samplesCopyToast']],
  ['samples copy: Duplicate', 'src/components/StyleCard.tsx', ['PLATFORM.samplesCopyToData', 'samplesCopyTarget(style.source_file)']],
  ['samples copy: New style', 'src/components/StyleEditorDialog.tsx', ['PLATFORM.samplesCopyToData', 'samplesCopyToast(source)']],
  ['SG_INIT without tab', 'src/bridge.ts', ["data.tab !== undefined && !isTab(data.tab)"]],
  ['catalog load never writes active_source', 'src/store/stylesStore.ts', ["PLATFORM.sourceChange === 'always'"]],
  ['host test: applied ledger', 'src/lib/appliedLedger.test.ts', ['web/js/applied_ledger.js']],
  ['host test: restored widgets', 'src/lib/restoredWidgets.test.ts', ['web/js/restored_widgets.js']],
  ['host test: messages', 'src/lib/hostMessages.test.ts', ['web/js/frame_messages.js', 'web/js/host_actions.js']],
  ['vite output and dev proxy', 'vite.config.ts', ["outDir: '../web/ui'", '8188', '/extensions/sd-comfyui-style-organizer/ui']],
]

describe('ComfyUI-only items after the convergence', () => {
  it.each(CHECKLIST)('%s (%s)', (_item, rel, symbols) => {
    const src = read(rel)
    for (const symbol of symbols) expect(src).toContain(symbol)
  })
})
