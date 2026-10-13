/**
 * MENU-DIAG catalog: every unique name appears under 2 sources so All-Sources
 * clicks open the source picker on any card (including bottom-right).
 */

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

const SOURCES = ['data/pack_a.csv', 'data/pack_b.csv']

/**
 * @param {number} n total style rows (≈ 2 × unique names)
 * @param {boolean} withThumb
 */
export function makeMenuSyntheticStyles(n, withThumb) {
  if (!Number.isInteger(n) || n < 2) {
    throw new Error(`makeMenuSyntheticStyles: n must be >= 2, got ${n}`)
  }
  const unique = Math.max(1, Math.floor(n / 2))
  /** @type {Array<{
   *   name: string
   *   prompt: string
   *   negative_prompt: string
   *   description: string
   *   category: string
   *   source_file: string
   *   has_thumbnail: boolean
   *   read_only: boolean
   * }>} */
  const styles = []
  for (let i = 0; i < unique; i += 1) {
    const cat = CATEGORIES[i % CATEGORIES.length]
    const name = `${cat}_Bench_${String(i).padStart(5, '0')}`
    for (const source_file of SOURCES) {
      styles.push({
        name,
        prompt: `bench prompt ${i}, 1girl, solo`,
        negative_prompt: `bench negative ${i}`,
        description: `MENU-DIAG ${i}`,
        category: cat,
        source_file,
        has_thumbnail: withThumb,
        read_only: false,
      })
    }
  }
  return styles.slice(0, n)
}
