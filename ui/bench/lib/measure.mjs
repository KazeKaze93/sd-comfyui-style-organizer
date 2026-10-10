import { makeSyntheticStyles } from './synthetic.mjs'

const CARD_SELECTOR = '.cursor-pointer.rounded-lg.border'
const SEARCH_SELECTOR = 'input[placeholder="Search styles..."]'
const LONG_TASK_THRESHOLD_MS = 50

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
 * @param {import('playwright').Page} page
 * @param {number} n
 */
async function injectInitAndMeasure(page, n) {
  const styles = makeSyntheticStyles(n)
  await clearLongTasks(page)

  const started = await page.evaluate((payload) => {
    const t0 = performance.now()
    window.postMessage({ type: 'SG_INIT', styles: payload }, '*')
    return t0
  }, styles)

  // Unvirtualized PHASE A: wait until all N cards mount.
  await page.waitForFunction(
    ({ sel, count }) => document.querySelectorAll(sel).length >= count,
    { sel: CARD_SELECTOR, count: n },
    { timeout: 300_000 },
  )

  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  )

  const initMs = await page.evaluate((t0) => performance.now() - t0, started)
  const longTasks = await readLongTasksSince(page, started)
  return { initMs, longTasks, started }
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
  // Restore full grid for scroll phase
  await page.waitForFunction(
    ({ sel, count }) => document.querySelectorAll(sel).length >= count,
    { sel: CARD_SELECTOR, count: restoreCount },
    { timeout: 180_000 },
  )
  return percentile(times, 50)
}

/**
 * @param {import('playwright').Page} page
 */
async function measureScrollTbt(page) {
  await clearLongTasks(page)
  const scrollStart = await page.evaluate(() => performance.now())

  await page.evaluate(async () => {
    const gridScroll = Array.from(document.querySelectorAll('div')).find((el) => {
      const style = getComputedStyle(el)
      return (
        style.overflowY === 'auto' &&
        el.scrollHeight > el.clientHeight + 40 &&
        el.querySelector('.cursor-pointer.rounded-lg.border')
      )
    })
    if (!gridScroll) throw new Error('grid scroll container not found')
    const max = gridScroll.scrollHeight - gridScroll.clientHeight
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
 * One full scenario for size N on a fresh page.
 * @param {import('playwright').Browser} browser
 * @param {{ baseUrl: string, n: number, cpuThrottle: number }} opts
 */
export async function runScenario(browser, opts) {
  const { baseUrl, n, cpuThrottle } = opts
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  await installLongTaskObserver(page)

  const { stubStyleGridApi } = await import('./stubApi.mjs')
  await stubStyleGridApi(page)

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await setCpuThrottle(page, cpuThrottle)
  await waitSgReady(page)

  const { initMs, longTasks } = await injectInitAndMeasure(page, n)
  const toggleP50Ms = await measureToggleP50(page, 21)
  const searchKeyP50Ms = await measureSearchKeyP50(page, 'Bench', n)
  const { scrollTbtMs } = await measureScrollTbt(page)

  await context.close()

  return {
    n,
    initMs,
    toggleP50Ms,
    searchKeyP50Ms,
    scrollTbtMs,
    longTasks: longTasks.length,
    longTaskDurationsMs: longTasks.map((t) => t.duration),
  }
}
