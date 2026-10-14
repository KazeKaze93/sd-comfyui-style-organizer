/**
 * Realistic synthetic Style[] + chrome for SG_INIT bench loads.
 * Deterministic for a given N.
 *
 * - 12 categories, 3 sources, ~10% duplicate names across sources
 * - names up to 40 chars, long descriptions
 * - ~5% favorites, 10 selected
 */

export const CATEGORIES = Object.freeze([
  'BASE',
  'CAMERA',
  'LIGHTING',
  'BODY',
  'HAIR',
  'POSE',
  'SCENE',
  'CLOTHES',
  'EXPRESSION',
  'STYLE',
  'THEME',
  'ACTION',
])

export const SOURCES = Object.freeze([
  'pack_alpha.csv',
  'pack_beta.csv',
  'pack_gamma.csv',
])

/** Fraction of unique base names that also appear under a second source. */
export const DUPLICATE_NAME_RATIO = 0.1

/** Fraction of unique names marked favorite. */
export const FAVORITE_RATIO = 0.05

/** How many styles to pre-select in layout/full benches. */
export const SELECTED_COUNT = 10

/** Max style name length (including category prefix). */
export const MAX_NAME_LENGTH = 40

/**
 * @param {number} n Total styles (including duplicate-name rows).
 * @returns {Array<{
 *   name: string
 *   prompt: string
 *   negative_prompt: string
 *   description: string
 *   category: string
 *   source_file: string
 *   has_thumbnail: boolean
 *   read_only: boolean
 * }>}
 */
export function makeSyntheticStyles(n) {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`makeSyntheticStyles: n must be positive integer, got ${n}`)
  }

  const styles = []
  let i = 0
  const uniqueTarget = Math.max(1, Math.ceil(n / (1 + DUPLICATE_NAME_RATIO)))
  const uniqueNames = []

  while (styles.length < Math.min(n, uniqueTarget)) {
    const cat = CATEGORIES[i % CATEGORIES.length]
    const source = SOURCES[i % SOURCES.length]
    const name = buildName(cat, i)
    uniqueNames.push(name)
    styles.push(makeStyle(name, cat, source, i))
    i += 1
  }

  let dupIdx = 0
  while (styles.length < n) {
    const baseName = uniqueNames[dupIdx % uniqueNames.length]
    const cat = baseName.split('_')[0] || CATEGORIES[0]
    const orig = styles.find((s) => s.name === baseName)
    const origSource = orig?.source_file ?? SOURCES[0]
    const altSource =
      SOURCES.find((s) => s !== origSource) ?? SOURCES[(dupIdx + 1) % SOURCES.length]
    styles.push(makeStyle(baseName, cat, altSource, i))
    dupIdx += 1
    i += 1
  }

  return styles
}

/**
 * Full bench scenario payload: styles + favorites/selected chrome.
 * @param {number} n
 */
export function makeBenchScenario(n) {
  const styles = makeSyntheticStyles(n)
  const favorites = buildFavorites(styles)
  const selected = styles.slice(0, Math.min(SELECTED_COUNT, styles.length))
  const uniqueNames = new Set(styles.map((s) => s.name))
  return {
    styles,
    favorites,
    selected,
    /** All-sources view dedupes by name — catalog item count uses this. */
    uniqueNameCount: uniqueNames.size,
  }
}

/**
 * @param {string} cat
 * @param {number} i
 */
function buildName(cat, i) {
  // Long-ish readable tail so displayName approaches MAX_NAME_LENGTH.
  const idx = String(i).padStart(5, '0')
  const raw = `${cat}_Bench_LongName_${idx}_X`
  if (raw.length <= MAX_NAME_LENGTH) return raw
  return raw.slice(0, MAX_NAME_LENGTH)
}

/**
 * @param {string} name
 * @param {string} category
 * @param {string} source_file
 * @param {number} seed
 */
function makeStyle(name, category, source_file, seed) {
  return {
    name,
    prompt: `bench prompt ${seed}, 1girl, solo, detailed face, intricate clothing, cinematic lighting, depth of field`,
    negative_prompt: `bench negative ${seed}, lowres, blurry, bad anatomy, watermark, text`,
    description:
      `Synthetic bench style ${seed} (${category}). Combos: CAMERA_Bench_00000, LIGHTING_Bench_00001. ` +
      `Long description padding to stress info panel and search indexing without affecting card chrome height.`,
    category,
    source_file,
    has_thumbnail: false,
    read_only: false,
  }
}

/**
 * ~5% of unique names as favorites.
 * @param {Array<{ name: string }>} styles
 * @returns {string[]}
 */
function buildFavorites(styles) {
  const seen = new Set()
  const unique = []
  for (const s of styles) {
    if (seen.has(s.name)) continue
    seen.add(s.name)
    unique.push(s.name)
  }
  const target = Math.max(1, Math.round(unique.length * FAVORITE_RATIO))
  const favs = []
  for (let i = 0; i < unique.length && favs.length < target; i += 1) {
    if (i % Math.max(1, Math.floor(1 / FAVORITE_RATIO)) === 0) {
      favs.push(unique[i])
    }
  }
  while (favs.length < target && favs.length < unique.length) {
    const name = unique[favs.length * 3 % unique.length]
    if (!favs.includes(name)) favs.push(name)
    else break
  }
  return favs
}

/** @deprecated Prefer makeSyntheticStyles — kept for older bench callers. */
export function generateStyles(n) {
  return makeSyntheticStyles(n)
}
