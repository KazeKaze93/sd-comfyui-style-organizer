/**
 * Platform seam: the one shared file whose VALUES differ between the WebUI
 * (Forge / reForge) and ComfyUI builds of this iframe. Every other shared
 * module reads these flags instead of branching on the host itself.
 *
 * This copy: ComfyUI (custom node, panel opened per node by web/js/style_grid.js).
 */
import { tagKeySet } from './tagIdentity'

export type FullscreenMode = 'host-message' | 'frame-element'
export type SourceChangeMode = 'always' | 'user-only'

export const PLATFORM = {
  /** LoRA view, CivitAI title fetch, /style_grid/lora/* (ComfyUI: no LoRA support). */
  lora: false,
  /** txt2img / img2img tabs: header badge and title; SG_INIT may come without a tab. */
  hostTabs: false,
  /** "Generate preview" / "Generate previews…" (ComfyUI: previews are uploaded only). */
  previewGeneration: false,
  /** Deck strip (SG_DECK_STATE / SG_DECK_RESTART / SG_DECK_NEW) under the wildcard chips. */
  deck: true,
  /**
   * 'host-message': ask the host (SG_SET_FULLSCREEN / SG_FULLSCREEN_STATE).
   * 'frame-element': the iframe resizes its own host wrapper via window.frameElement.
   */
  fullscreenMode: 'frame-element' as FullscreenMode,
  /**
   * 'always': SG_SOURCE_CHANGE on every catalog push (null included).
   * 'user-only': only when the user picks a source; a catalog load never writes
   * the node's active_source.
   */
  sourceChange: 'user-only' as SourceChangeMode,
  /** First segment of a public source id `<prefix>/<file.csv>` (stylegrid/source_ids.py). */
  sourceIdPrefixes: ['data', 'imports', 'samples'] as readonly string[],
  /** `shared/<dir>/<file.csv>` ids (WebUI only). */
  sharedSourceIds: false,
  /**
   * Bundled samples are read-only. true (ComfyUI): Duplicate on a sample style and
   * New style while a samples source is active write to `data/<same file>` and switch
   * the source filter there. false (WebUI): both are refused.
   */
  samplesCopyToData: true,
  /** After saving an applied style without a rename, UNAPPLY + APPLY it so the node text follows. */
  reapplyEditedStyles: true,
  /** Tag keys of a prompt for conflict detection (ComfyUI: the node's drop_shared_tags identity). */
  conflictKeySet: tagKeySet as (text: string) => Set<string>,
  /** What a Shuffle deck advances per step. */
  shuffleScopeLabel: 'queue run',
  /** Sub-line of the Shuffle menu item. */
  shuffleMenuSub: 'whole category, no repeats between queue runs',
  /** Scope part of the Shuffle chip title. */
  shuffleChipScope: 'one step per queue run',
  /** Where the samples pack lives, for the read-only restore hint. */
  hostName: 'ComfyUI',
} as const
