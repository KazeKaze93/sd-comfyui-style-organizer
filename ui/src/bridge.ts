import type { ThemeMode } from './lib/themeMode'

/** Messages sent from ComfyUI host extension (web/js/style_grid.js) to the React iframe. */
export type HostMessage =
  | { type: 'SG_CLEAR_SELECTION' }
  | { type: 'SG_INIT';           styles: Style[] }
  | { type: 'SG_TOAST'; message: string; variant: 'success' | 'error' | 'info' }
  | { type: 'SG_STYLE_APPLIED'; style: Style }
  | { type: 'SG_WILDCARDS_ACTIVE'; categories: WildcardRef[] }
  | { type: 'SG_CLOSE' }
  | { type: 'SG_THEME'; mode: ThemeMode }
  | { type: 'SG_DECK_STATE'; seed: number; index: number }

/** Messages sent from the React iframe back to ComfyUI host extension (web/js/style_grid.js). */
export type FrameMessage =
  | { type: 'SG_READY' }
  | { type: 'SG_APPLY';         styleId: string; prompt: string; neg: string; source_file: string }
  | { type: 'SG_UNAPPLY';       styleId: string; source_file: string }
  | { type: 'SG_WILDCARD_CATEGORY'; category: string; kind?: WildcardKind }
  | { type: 'SG_WILDCARD_SLICE'; category: string; spec: string; kind?: WildcardKind }
  | { type: 'SG_REMOVE_WILDCARD'; category: string; spec: string; kind?: WildcardKind }
  /** styleIds are styleRowKey values (`source_file\\0name`). */
  | { type: 'SG_REORDER_STYLES'; styleIds: string[] }
  | { type: 'SG_REORDER_WILDCARDS'; categories: WildcardRef[] }
  | { type: 'SG_CLOSE_REQUEST' }
  | { type: 'SG_CLEAR_ALL' }
  | { type: 'SG_SOURCE_CHANGE'; source: string | null }
  | { type: 'SG_DECK_RESTART' }
  | { type: 'SG_DECK_NEW' }

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

function bridgeOrigin(): string {
  return window.location.origin
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark'
}

function isToastVariant(value: unknown): value is 'success' | 'error' | 'info' {
  return value === 'success' || value === 'error' || value === 'info'
}

/**
 * Runtime guard for host → iframe HostMessage shapes (SG_*).
 * Unknown types and malformed payloads return null.
 */
export function parseHostMessage(data: unknown): HostMessage | null {
  if (!isRecord(data)) return null
  const type = data.type
  if (typeof type !== 'string' || !type.startsWith('SG_')) return null

  switch (type) {
    case 'SG_CLEAR_SELECTION':
    case 'SG_CLOSE':
      return { type }

    case 'SG_THEME':
      if (!isThemeMode(data.mode)) return null
      return { type, mode: data.mode }

    case 'SG_INIT':
      if (!Array.isArray(data.styles)) return null
      return { type, styles: data.styles as Style[] }

    case 'SG_WILDCARDS_ACTIVE':
      if (!Array.isArray(data.categories)) return null
      return { type, categories: data.categories as WildcardRef[] }

    case 'SG_TOAST':
      if (typeof data.message !== 'string') return null
      if (!isToastVariant(data.variant)) return null
      return { type, message: data.message, variant: data.variant }

    case 'SG_STYLE_APPLIED':
      if (!isRecord(data.style)) return null
      return { type, style: data.style as unknown as Style }

    case 'SG_DECK_STATE':
      if (typeof data.seed !== 'number') return null
      if (typeof data.index !== 'number') return null
      return { type, seed: data.seed, index: data.index }

    default:
      return null
  }
}

/** True when the event is same-origin and from the parent (host) window. */
export function isTrustedHostEvent(event: MessageEvent): boolean {
  if (event.origin !== bridgeOrigin()) return false
  if (event.source !== window.parent) return false
  return true
}

/** Posts one typed bridge message to the ComfyUI host extension (web/js/style_grid.js). */
export function sendToHost(msg: FrameMessage): void {
  window.parent.postMessage(msg, bridgeOrigin())
}

/**
 * Subscribes to host postMessage events and returns an unsubscribe cleanup.
 * Foreign origin, wrong source, unknown types, and malformed payloads are ignored.
 */
export function onHostMessage(
  handler: (msg: HostMessage) => void
): () => void {
  const listener = (e: MessageEvent) => {
    if (!isTrustedHostEvent(e)) return
    const msg = parseHostMessage(e.data)
    if (!msg) return
    handler(msg)
  }
  window.addEventListener('message', listener)
  return () => window.removeEventListener('message', listener)
}
