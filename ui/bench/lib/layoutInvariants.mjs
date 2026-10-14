/**
 * Layout invariants for the virtualized style grid.
 *
 * (1) every card height <= CARD_ROW_HEIGHT - ROW_GAP + TOL
 * (2) vertical gap between adjacent card rows == ROW_GAP ± TOL
 *     and == horizontal gap ± TOL
 * (3) no card rect overlaps another
 *
 * Prints up to MAX_OFFENDERS offenders on failure.
 */

import { metricsForDensity } from './gridMetrics.mjs'

export const CARD_SELECTOR = '.cursor-pointer.rounded-lg.border'
export const LAYOUT_TOL_PX = 0.5
export const MAX_OFFENDERS = 10

/**
 * @typedef {{
 *   ok: boolean
 *   density: string
 *   position: string
 *   n: number
 *   expected: { rowGapPx: number, maxCardHeightPx: number, cardRowHeightPx: number }
 *   measured: {
 *     cardCount: number
 *     hGapPx: number | null
 *     vGaps: number[]
 *     tallCards: number
 *     overlapPairs: number
 *   }
 *   offenders: string[]
 * }} LayoutCheckResult
 */

/**
 * Run layout invariants in the page for the active density.
 * @param {import('playwright').Page} page
 * @param {{
 *   density: 'windowed' | 'compact-windowed' | 'normal' | 'compact'
 *   position: 'top' | 'scrolled'
 *   n: number
 * }} opts
 * @returns {Promise<LayoutCheckResult>}
 */
export async function checkLayoutInvariants(page, opts) {
  const { density, position, n } = opts
  const expected = metricsForDensity(density)
  const raw = await page.evaluate(
    ({ cardSel, maxH, rowGap, tol }) => {
      const cards = [...document.querySelectorAll(cardSel)]
      /** @type {string[]} */
      const offenders = []

      // (1) card height
      let tallCards = 0
      for (let i = 0; i < cards.length; i += 1) {
        const h = cards[i].getBoundingClientRect().height
        if (h > maxH + tol) {
          tallCards += 1
          if (offenders.length < 10) {
            offenders.push(
              `tall card#${i} height=${h.toFixed(2)} > max=${(maxH + tol).toFixed(2)}`,
            )
          }
        }
      }

      // Adjacent card rows (skip headers / non-consecutive virtual indexes)
      const cardRows = [...document.querySelectorAll('[data-sg-row-kind="cards"]')].sort(
        (a, b) =>
          Number(a.getAttribute('data-index') || 0) -
          Number(b.getAttribute('data-index') || 0),
      )

      /** @type {number[]} */
      const vGaps = []
      for (let i = 1; i < cardRows.length; i += 1) {
        const prev = cardRows[i - 1]
        const next = cardRows[i]
        const prevIdx = Number(prev.getAttribute('data-index'))
        const nextIdx = Number(next.getAttribute('data-index'))
        if (!Number.isFinite(prevIdx) || nextIdx !== prevIdx + 1) continue
        const a = prev.querySelector(cardSel)?.getBoundingClientRect()
        const b = next.querySelector(cardSel)?.getBoundingClientRect()
        if (!a || !b) continue
        const gap = b.top - a.bottom
        vGaps.push(gap)
        if (Math.abs(gap - rowGap) > tol && offenders.length < 10) {
          offenders.push(
            `vGap rows ${prevIdx}→${nextIdx} gap=${gap.toFixed(2)} expected=${rowGap}±${tol}`,
          )
        }
      }

      // Horizontal gap from first card row with ≥2 cards
      let hGap = null
      for (const row of cardRows) {
        const rowCards = [...row.querySelectorAll(cardSel)]
        if (rowCards.length < 2) continue
        const a = rowCards[0].getBoundingClientRect()
        const b = rowCards[1].getBoundingClientRect()
        hGap = b.left - a.right
        if (Math.abs(hGap - rowGap) > tol && offenders.length < 10) {
          offenders.push(
            `hGap=${hGap.toFixed(2)} expected rowGap=${rowGap}±${tol}`,
          )
        }
        break
      }

      // Gap parity: each vGap == hGap
      if (hGap != null) {
        for (let i = 0; i < vGaps.length; i += 1) {
          if (Math.abs(vGaps[i] - hGap) > tol && offenders.length < 10) {
            offenders.push(
              `gapParity vGaps[${i}]=${vGaps[i].toFixed(2)} vs hGap=${hGap.toFixed(2)}`,
            )
          }
        }
      }

      // (3) no overlaps (axis-aligned, tol shrink)
      let overlapPairs = 0
      const rects = cards.map((el, idx) => {
        const r = el.getBoundingClientRect()
        return { idx, left: r.left, right: r.right, top: r.top, bottom: r.bottom }
      })
      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
          const a = rects[i]
          const b = rects[j]
          const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left)
          const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
          if (overlapX > tol && overlapY > tol) {
            overlapPairs += 1
            if (offenders.length < 10) {
              offenders.push(
                `overlap card#${a.idx}×#${b.idx} ox=${overlapX.toFixed(2)} oy=${overlapY.toFixed(2)}`,
              )
            }
          }
        }
      }

      const vGapOk =
        vGaps.length > 0 && vGaps.every((g) => Math.abs(g - rowGap) <= tol)
      const hGapOk = hGap != null && Math.abs(hGap - rowGap) <= tol
      const parityOk =
        hGap != null && vGaps.every((g) => Math.abs(g - hGap) <= tol)
      const heightOk = tallCards === 0
      const overlapOk = overlapPairs === 0

      return {
        ok: heightOk && vGapOk && hGapOk && parityOk && overlapOk && cards.length > 0,
        cardCount: cards.length,
        hGapPx: hGap,
        vGaps,
        tallCards,
        overlapPairs,
        offenders,
        checks: { heightOk, vGapOk, hGapOk, parityOk, overlapOk },
      }
    },
    {
      cardSel: CARD_SELECTOR,
      maxH: expected.maxCardHeightPx,
      rowGap: expected.rowGapPx,
      tol: LAYOUT_TOL_PX,
    },
  )

  // Cap offenders client-side too
  const offenders = (raw.offenders || []).slice(0, MAX_OFFENDERS)
  let ok = Boolean(raw.ok)
  if (raw.cardCount === 0) {
    ok = false
    offenders.unshift('no cards mounted in viewport')
  }
  if ((raw.vGaps || []).length === 0 && raw.cardCount > 0) {
    ok = false
    offenders.push('no adjacent card-row pairs to measure vertical gap')
  }

  return {
    ok,
    density,
    position,
    n,
    expected: {
      rowGapPx: expected.rowGapPx,
      maxCardHeightPx: expected.maxCardHeightPx,
      cardRowHeightPx: expected.cardRowHeightPx,
    },
    measured: {
      cardCount: raw.cardCount,
      hGapPx: raw.hGapPx,
      vGaps: raw.vGaps,
      tallCards: raw.tallCards,
      overlapPairs: raw.overlapPairs,
    },
    offenders,
  }
}

/**
 * Inject a "glue" fixture so invariants must FAIL (dev harness only).
 * Adds an extra line past fixed card row height.
 * @param {import('playwright').Page} page
 */
export async function injectGlueFixture(page) {
  await page.evaluate((cardSel) => {
    for (const el of document.querySelectorAll(cardSel)) {
      /** @type {HTMLElement} */
      const card = /** @type {HTMLElement} */ (el)
      card.style.height = 'auto'
      card.style.overflow = 'visible'
      card.style.minHeight = '0'
      if (card.querySelector('[data-sg-glue-fixture]')) continue
      const line = document.createElement('span')
      line.dataset.sgGlueFixture = '1'
      line.className = 'mt-0.5 block font-mono text-[10px] leading-none text-sg-muted'
      line.textContent = '99+'
      card.appendChild(line)
    }
  }, CARD_SELECTOR)
}

/**
 * Print a failed layout check (up to MAX_OFFENDERS lines).
 * @param {LayoutCheckResult} result
 */
export function printLayoutFailure(result) {
  console.error(
    `[layout] FAIL N=${result.n} density=${result.density} pos=${result.position} ` +
      `maxH=${result.expected.maxCardHeightPx} rowGap=${result.expected.rowGapPx}`,
  )
  console.error(
    `[layout] measured cards=${result.measured.cardCount} hGap=${result.measured.hGapPx} ` +
      `vGaps=${JSON.stringify(result.measured.vGaps.slice(0, 8))} ` +
      `tall=${result.measured.tallCards} overlaps=${result.measured.overlapPairs}`,
  )
  for (const o of result.offenders.slice(0, MAX_OFFENDERS)) {
    console.error(`  · ${o}`)
  }
}
