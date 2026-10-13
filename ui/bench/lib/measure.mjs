import { makeBenchScenario, usageApiBody } from './synthetic.mjs'
import {
  checkLayoutInvariants,
  printLayoutFailure,
} from './layoutInvariants.mjs'

const CARD_SELECTOR = '.cursor-pointer.rounded-lg.border'
const SEARCH_SELECTOR = 'input[placeholder="Search styles..."]'
const LONG_TASK_THRESHOLD_MS = 50
/** Layout invariant sizes inside full `npm run bench` (keep cheap). */
const LAYOUT_CHECK_SIZES = new Set([500, 5000])
const LAYOUT_DENSITIES_IN_FULL = /** @type {const} */ ([
  'windowed',
  'normal',
])

/**
 * @param {number[]} values
 * @returns {number}
 */
export function median(values) {
  if (values.length === 0) throw new Error('median: empty')
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]
  return (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * @param {number[]} values
 * @param {number} p
 * @returns {number}
 */
export function percentile(values, p) {
  if (values.length === 0) throw new Error('percentile: empty')
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  )
  return sorted[idx]
}

/**
 * Classic TBT: sum of (duration - 50) for long tasks > 50 ms.
 * @param {Array<{ duration: number }>} tasks
 */
export function totalBlockingTime(tasks) {
  let tbt = 0
  for (const t of tasks) {
    if (t.duration > LONG_TASK_THRESHOLD_MS) {
      tbt += t.duration - LONG_TASK_THRESHOLD_MS
    }
  }
  return tbt
}

/**
 * @param {import('playwright').Page} page
 * @param {number} rate
 */
export async function setCpuThrottle(page, rate) {
  const client = await page.context().newCDPSession(page)
  await client.send('Emulation.setCPUThrottlingRate', { rate })
  return client
}

/**
 * @param {import('playwright').Page} page
 */
export async function installLongTaskObserver(page) {
  await page.addInitScript(() => {
    window.__sgBench = {
      ready: false,
      longTasks: [],
    }
    window.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'SG_READY') {
        window.__sgBench.ready = true
      }
    })
    try {
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__sgBench.longTasks.push({
            start: entry.startTime,
            duration: entry.duration,
            name: entry.name,
          })
        }
      })
      obs.observe({ type: 'longtask', buffered: true })
    } catch {
      // longtask not supported — metrics stay empty
    }
  })
}

/**
 * @param {import('playwright').Page} page
 */
async function waitSgReady(page) {
  await page.waitForFunction(() => Boolean(window.__sgBench?.ready), null, {
    timeout: 60_000,
  })
}

/**
 * @param {import('playwright').Page} page
 */
async function clearLongTasks(page) {
  await page.evaluate(() => {
    window.__sgBench.longTasks = []
  })
}

/**
 * @param {import('playwright').Page} page
 * @param {number} since
 */
async function readLongTasksSince(page, since) {
  return page.evaluate((sinceMark) => {
    return window.__sgBench.longTasks.filter((t) => t.start >= sinceMark)
  }, since)
}

/**
 * Virtualized grid mounts only viewport cards; readiness is catalog count + ≥1 card.
 * @param {import('playwright').Page} page
 * @param {number} count
 * @param {number} [timeoutMs]
 */
async function waitCatalogReady(page, count, timeoutMs = 300_000) {
  await page.waitForFunction(
    ({ sel, want }) => {
      const grid = document.querySelector('[data-sg-item-count]')
      if (!grid) return false
      const items = Number(grid.getAttribute('data-sg-item-count') || '0')
      return items >= want && document.querySelectorAll(sel).length >= 1
    },
    { sel: CARD_SELECTOR, want: count },
    { timeout: timeoutMs },
  )
}

/**
 * @param {import('playwright').Page} page
 * @param {number} n
 * @param {ReturnType<typeof makeBenchScenario>} [scenario]
 */
async function injectInitAndMeasure(page, n, scenario) {
  const payload = scenario ?? makeBenchScenario(n)
  await clearLongTasks(page)

  const started = await page.evaluate((styles) => {
    const t0 = performance.now()
    window.postMessage({ type: 'SG_INIT', styles }, '*')
    return t0
  }, payload.styles)

  // All-sources view dedupes by name; catalog attribute reflects unique names.
  await waitCatalogReady(page, payload.uniqueNameCount ?? n)

  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  )

  const initMs = await page.evaluate((t0) => performance.now() - t0, started)
  const longTasks = await readLongTasksSince(page, started)
  return { initMs, longTasks, started, scenario: payload }
}

/**
 * Prefer a single source so duplicate-name rows do not open the source picker.
 * @param {import('playwright').Page} page
 * @returns {Promise<number>} Settled catalog item count after the filter.
 */
async function selectFirstSource(page) {
  await page.evaluate(() => {
    const select = document.querySelector('select')
    if (!(select instanceof HTMLSelectElement) || select.options.length < 2) return
    const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    proto?.call(select, select.options[1].value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  )

  let last = -1
  let stableHits = 0
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline && stableHits < 4) {
    const count = await page.evaluate(() => {
      const grid = document.querySelector('[data-sg-item-count]')
      return grid ? Number(grid.getAttribute('data-sg-item-count') || '0') : -1
    })
    if (count > 0 && count === last) stableHits += 1
    else stableHits = 0
    last = count
    await page.waitForTimeout(50)
  }
  if (last < 1) throw new Error('selectFirstSource: catalog did not settle')
  return last
}

/**
 * @param {import('playwright').Page} page
 * @param {number} samples
 */
async function measureToggleP50(page, samples) {
  const times = []
  const cards = page.locator(CARD_SELECTOR)
  const available = await cards.count()
  const n = Math.min(samples, available)
  for (let i = 0; i < n; i += 1) {
    const card = cards.nth(i)
    const beforeSelected = await card.evaluate((el) =>
      el.className.includes('bg-sg-accent'),
    )
    const t0 = await page.evaluate(() => performance.now())
    await card.click({ trial: false })
    await page.waitForFunction(
      ({ sel, index, want }) => {
        const el = document.querySelectorAll(sel)[index]
        if (!el) return false
        return el.className.includes('bg-sg-accent') === want
      },
      { sel: CARD_SELECTOR, index: i, want: !beforeSelected },
      { timeout: 10_000 },
    )
    const t1 = await page.evaluate(() => performance.now())
    times.push(t1 - t0)
  }
  return percentile(times, 50)
}

/**
 * @param {import('playwright').Page} page
 * @param {string} query
 * @param {number} restoreCount
 */
async function measureSearchKeyP50(page, query, restoreCount) {
  const input = page.locator(SEARCH_SELECTOR).first()
  await input.click()
  await input.fill('')
  await page.keyboard.press('Escape')
  await input.click()

  const times = []
  for (const ch of query) {
    const t0 = await page.evaluate(() => performance.now())
    await page.keyboard.type(ch, { delay: 0 })
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    )
    const t1 = await page.evaluate(() => performance.now())
    times.push(t1 - t0)
  }

  await input.fill('')
  await page.keyboard.press('Escape')
  // Restore full catalog for scroll phase (DOM cards ≠ N when virtualized).
  // restoreCount should be uniqueNameCount when All-sources is active.
  await waitCatalogReady(page, restoreCount, 180_000)
  return percentile(times, 50)
}

/**
 * @param {import('playwright').Page} page
 */
async function measureScrollTbt(page) {
  await clearLongTasks(page)
  const scrollStart = await page.evaluate(() => performance.now())

  await page.evaluate(async () => {
    // Same element VirtualStyleGrid binds: parent of [data-sg-item-count].
    const gridRoot = document.querySelector('[data-sg-item-count]')
    const gridScroll = gridRoot?.parentElement
    if (!gridScroll) throw new Error('grid scroll container not found (parent of data-sg-item-count)')
    const max = gridScroll.scrollHeight - gridScroll.clientHeight
    if (max <= 40) throw new Error('grid scroll container not scrollable')
    const steps = 12
    for (let i = 1; i <= steps; i += 1) {
      gridScroll.scrollTop = Math.round((max * i) / steps)
      await new Promise((r) => requestAnimationFrame(r))
    }
    await new Promise((r) => setTimeout(r, 100))
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  })

  const tasks = await readLongTasksSince(page, scrollStart)
  return { scrollTbtMs: totalBlockingTime(tasks), scrollLongTasks: tasks }
}

/**
 * Layout invariants at a couple densities (full bench only).
 * @param {import('playwright').Page} page
 * @param {number} n
 */
async function runLayoutInvariantsInScenario(page, n) {
  if (!LAYOUT_CHECK_SIZES.has(n)) return { ok: true, checks: [] }

  const { installFakeIframe, setDensity, scrollThreeScreens } = await import(
    './benchHost.mjs'
  )
  await installFakeIframe(page)

  /** @type {import('./layoutInvariants.mjs').LayoutCheckResult[]} */
  const checks = []
  for (const density of LAYOUT_DENSITIES_IN_FULL) {
    await setDensity(page, density)
    await page.waitForTimeout(100)
    for (const position of /** @type {const} */ (['top', 'scrolled'])) {
      if (position === 'scrolled') await scrollThreeScreens(page)
      else {
        await page.evaluate(() => {
          const grid = document.querySelector('[data-sg-item-count]')
          const scrollEl = grid?.parentElement
          if (scrollEl) scrollEl.scrollTop = 0
        })
        await page.waitForTimeout(50)
      }
      const check = await checkLayoutInvariants(page, {
        density,
        position,
        n,
      })
      checks.push(check)
      if (!check.ok) printLayoutFailure(check)
    }
  }
  return { ok: checks.every((c) => c.ok), checks }
}

/**
 * One full scenario for size N on a fresh page.
 * @param {import('playwright').Browser} browser
 * @param {{ baseUrl: string, n: number, cpuThrottle: number, layoutInvariants?: boolean }} opts
 */
export async function runScenario(browser, opts) {
  const { baseUrl, n, cpuThrottle } = opts
  const layoutInvariants = opts.layoutInvariants !== false
  const scenario = makeBenchScenario(n)
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  await installLongTaskObserver(page)

  await page.addInitScript((favs) => {
    try {
      localStorage.setItem('sg_v2_favorites', JSON.stringify(favs))
    } catch {
      // ignore
    }
  }, scenario.favorites)

  const { stubStyleGridApi } = await import('./stubApi.mjs')
  await stubStyleGridApi(page, { usage: usageApiBody(scenario.usageCounts) })

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await setCpuThrottle(page, cpuThrottle)
  await waitSgReady(page)

  const { initMs, longTasks } = await injectInitAndMeasure(page, n, scenario)
  // All-sources + duplicate names open the source picker on click; pin a
  // source so toggle/search/scroll measure selection, not the picker overlay.
  const catalogAfterSource = await selectFirstSource(page)
  const toggleP50Ms = await measureToggleP50(page, 21)
  const searchKeyP50Ms = await measureSearchKeyP50(
    page,
    'Bench',
    catalogAfterSource,
  )
  const { scrollTbtMs } = await measureScrollTbt(page)

  let layout = { ok: true, checks: /** @type {unknown[]} */ ([]) }
  if (layoutInvariants) {
    layout = await runLayoutInvariantsInScenario(page, n)
  }

  await context.close()

  return {
    n,
    initMs,
    toggleP50Ms,
    searchKeyP50Ms,
    scrollTbtMs,
    longTasks: longTasks.length,
    longTaskDurationsMs: longTasks.map((t) => t.duration),
    layoutOk: layout.ok,
    layoutChecks: layout.checks,
  }
}
