/** Synthetic Style[] for SG_INIT bench loads. Deterministic for a given N. */

const CATEGORIES = [
  'BASE',
  'CAMERA',
  'LIGHTING',
  'BODY',
  'HAIR',
  'POSE',
  'SCENE',
  'STYLE',
  'CLOTHES',
  'THEME',
]

/**
 * @param {number} n
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
  for (let i = 0; i < n; i += 1) {
    const cat = CATEGORIES[i % CATEGORIES.length]
    const name = `${cat}_Bench_${String(i).padStart(5, '0')}`
    styles.push({
      name,
      prompt: `bench prompt ${i}, 1girl, solo`,
      negative_prompt: `bench negative ${i}`,
      description: `Synthetic bench style ${i}`,
      category: cat,
      source_file: 'data/bench.csv',
      has_thumbnail: false,
      read_only: false,
    })
  }
  return styles
}
