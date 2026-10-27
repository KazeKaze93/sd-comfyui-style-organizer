/**
 * Tag identity for conflict detection — mirrors stylegrid/prompt_ops.py
 * `_parse` / `_tag_key` / `drop_shared_tags` (raw comma split, not top-level).
 */

const EXPLICIT_WEIGHT = /^\((?<tag>[^():]+):(?<weight>\d+(?:\.\d+)?)\)$/
const BRACKET_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['(', ')'],
  ['[', ']'],
  ['<', '>'],
  ['{', '}'],
]
const SYNTAX_CHARS = '()[]<>{}:'

function isBalanced(segment: string): boolean {
  return BRACKET_PAIRS.every(
    ([o, c]) => segment.split(o).length === segment.split(c).length,
  )
}

/** Case-insensitive key for a single already-trimmed prompt segment. */
export function tagKey(segment: string): string {
  if (!isBalanced(segment)) return segment.toLowerCase()
  const match = EXPLICIT_WEIGHT.exec(segment)
  if (match?.groups?.tag !== undefined) {
    return match.groups.tag.trim().toLowerCase()
  }
  if ([...SYNTAX_CHARS].some((ch) => segment.includes(ch))) {
    return segment.toLowerCase()
  }
  return segment.toLowerCase()
}

/**
 * Keys present in a prompt/negative string for conflict intersection.
 * Splits on raw "," like drop_shared_tags; skips empty, "{prompt}", and BREAK.
 */
export function tagKeySet(text: string): Set<string> {
  const out = new Set<string>()
  for (const raw of (text || '').split(',')) {
    const seg = raw.trim()
    if (!seg) continue
    if (seg.toLowerCase() === '{prompt}') continue
    if (seg.toUpperCase() === 'BREAK') continue
    out.add(tagKey(seg))
  }
  return out
}
