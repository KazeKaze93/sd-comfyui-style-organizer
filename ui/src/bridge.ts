import type { ThemeMode } from './lib/themeMode'

/** Messages sent from ComfyUI host extension (web/js/style_grid.js) to the React iframe. */
export type HostMessage =
  | { type: 'SG_CLEAR_SELECTION' }
  | { type: 'SG_INIT';           styles: Style[] }
  | { type: 'SG_TOAST'; message: string; variant: 'success' | 'error' | 'info' }
  | { type: 'SG_STYLE_APPLIED'; style: Style }
  | { type: 'SG_WILDCARDS_ACTIVE'; categories: WildcardRef[] }
  | { type: 'SG_THUMB_DONE';     styleId: string; version: number; source_file: string }
  | { type: 'SG_PROMPT_CHANGED'; prompt: string; neg: string }
  | { type: 'SG_CLOSE' }
  | { type: 'SG_THEME'; mode: ThemeMode }

/** Messages sent from the React iframe back to ComfyUI host extension (web/js/style_grid.js). */
export type FrameMessage =
  | { type: 'SG_READY' }
  | { type: 'SG_APPLY';         styleId: string; prompt: string; neg: string; source_file?: string }
  | { type: 'SG_UNAPPLY';       styleId: string; source_file?: string }
  | { type: 'SG_WILDCARD_CATEGORY'; category: string; kind?: WildcardKind }
  | { type: 'SG_WILDCARD_SLICE'; category: string; spec: string; kind?: WildcardKind }
  | { type: 'SG_REMOVE_WILDCARD'; category: string; spec: string; kind?: WildcardKind }
  | { type: 'SG_REORDER_STYLES'; styleIds: string[] }
  | { type: 'SG_REORDER_WILDCARDS'; categories: WildcardRef[] }
  | { type: 'SG_CLOSE_REQUEST' }
  | { type: 'SG_CLEAR_ALL' }
  | { type: 'SG_SOURCE_CHANGE'; source: string | null }

// ── Shared types ──────────────────────────────────────────────
export type WildcardKind = 'sg' | 'sgd'
export const WILDCARD_KIND_DICE: WildcardKind = 'sg'
export const WILDCARD_KIND_DECK: WildcardKind = 'sgd'

/** Category + optional slice spec for `{sg|sgd:category}` / `{sg|sgd:category:spec}` tokens. */
export interface WildcardRef {
  category: string
  spec: string
  /** Absent or `'sg'` = dice; `'sgd'` = deck (without replacement). */
  kind?: WildcardKind
}

export interface Style {
  name:              string
  prompt:            string
  negative_prompt:   string
  description:       string
  category:          string
  source_file:       string
  has_thumbnail:     boolean
  read_only:         boolean
}

/** Posts one typed bridge message to the ComfyUI host extension (web/js/style_grid.js). */
export function sendToHost(msg: FrameMessage): void {
  window.parent.postMessage(msg, '*')
}

/**
 * Subscribes to host postMessage events and returns an unsubscribe cleanup.
 */
export function onHostMessage(
  handler: (msg: HostMessage) => void
): () => void {
  const listener = (e: MessageEvent) => {
    if (e.data && typeof e.data.type === 'string') handler(e.data)
  }
  window.addEventListener('message', listener)
  return () => window.removeEventListener('message', listener)
}
