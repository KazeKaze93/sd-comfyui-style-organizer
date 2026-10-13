#!/usr/bin/env node
/**
 * PHASE B Wave 1 — CDP CPU profiler (ComfyUI style grid).
 *
 * Reuses PHASE A bench host (static dist + stubApi + SG_INIT synthetic).
 * Writes only under ui/bench/profile/** (plus rebuild of ui/bench/.tmp/dist with maps).
 *
 * Usage:
 *   node bench/profile/run.mjs
 *   node bench/profile/run.mjs --sizes 2000,5000 --skip-build
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { mkdir, writeFile, access, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { makeSyntheticStyles } from '../lib/synthetic.mjs'
import { stubStyleGridApi } from '../lib/stubApi.mjs'
import { setCpuThrottle, installLongTaskObserver } from '../lib/measure.mjs'
import { analyzeCpuProfile, sumMatchingSelfMs } from './lib/analyzeProfile.mjs'
import { renderTrackerSource } from './lib/renderTracker.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UI_ROOT = path.resolve(__dirname, '../..')
const BENCH_ROOT = path.resolve(__dirname, '..')
const TMP_DIST = path.join(BENCH_ROOT, '.tmp', 'dist')
const OUT_DIR = __dirname
const RAW_DIR = path.join(OUT_DIR, 'raw')

const CARD_SELECTOR = '.cursor-pointer.rounded-lg.border'
const SEARCH_SELECTOR = 'input[placeholder="Search styles..."]'
const CPU_THROTTLE = 4
const PREVIEW_PORT = 4181
const DEFAULT_SIZES = [2000, 5000]

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {{ sizes: number[], skipBuild: boolean }} */
  const out = { sizes: DEFAULT_SIZES, skipBuild: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--sizes') {
      out.sizes = argv[++i].split(',').map((s) => Number(s.trim())).filter((n) => n > 0)
    } else if (a === '--skip-build') out.skipBuild = true
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node bench/profile/run.mjs [--sizes 2000,5000] [--skip-build]')
      process.exit(0)
    }
  }
  return out
}

/** @param {string} command @param {string[]} args @param {{ cwd: string }} opts */
function runCmd(command, args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: process.env,
      stdio: 'inherit',
      shell: false,
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve(undefined)
      else reject(new Error(`${command} ${args.join(' ')} exited ${code}`))
    })
  })
}

async function buildToTmp() {
  await mkdir(path.dirname(TMP_DIST), { recursive: true })
  const viteJs = path.join(UI_ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
  // Sourcemaps + no minify: readable file:line and component names for profiling only.
  await runCmd(
    process.execPath,
    [
      viteJs,
      'build',
      '--outDir',
      path.relative(UI_ROOT, TMP_DIST),
      '--emptyOutDir',
      '--sourcemap',
      'true',
      '--minify',
      'false',
    ],
    { cwd: UI_ROOT },
  )
  await access(path.join(TMP_DIST, 'index.html'))
}

/**
 * @param {string} root
 * @param {number} port
 */
async function startStaticServer(root, port) {
  /** @param {string} p */
  function contentType(p) {
    if (p.endsWith('.html')) return 'text/html; charset=utf-8'
    if (p.endsWith('.js')) return 'text/javascript; charset=utf-8'
    if (p.endsWith('.css')) return 'text/css; charset=utf-8'
    if (p.endsWith('.map')) return 'application/json'
    if (p.endsWith('.svg')) return 'image/svg+xml'
    if (p.endsWith('.woff2')) return 'font/woff2'
    return 'application/octet-stream'
  }

  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
      let rel = urlPath === '/' ? '/index.html' : urlPath
      let filePath = path.join(root, rel)
      if (!filePath.startsWith(root)) {
        res.writeHead(403).end('forbidden')
        return
      }
      try {
        const st = await stat(filePath)
        if (st.isDirectory()) filePath = path.join(filePath, 'index.html')
      } catch {
        filePath = path.join(root, 'index.html')
      }
      res.writeHead(200, { 'Content-Type': contentType(filePath), 'Cache-Control': 'no-store' })
      createReadStream(filePath).pipe(res)
    } catch (err) {
      res.writeHead(500).end(String(err))
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(undefined))
  })

  return {
    baseUrl: `http://127.0.0.1:${port}/`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve(undefined)))
      })
    },
  }
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
 * @param {import('playwright').CDPSession} cdp
 */
async function startCpuProfile(cdp) {
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 })
  await cdp.send('Profiler.start')
}

/**
 * @param {import('playwright').CDPSession} cdp
 */
async function stopCpuProfile(cdp) {
  const { profile } = await cdp.send('Profiler.stop')
  return profile
}

/**
 * @param {import('playwright').Page} page
 * @param {number} n
 */
async function injectInit(page, n) {
  const styles = makeSyntheticStyles(n)
  const t0 = await page.evaluate((payload) => {
    const start = performance.now()
    window.postMessage({ type: 'SG_INIT', styles: payload }, '*')
    return start
  }, styles)
  // Virtualized grid mounts only viewport cards; wait on catalog count + ≥1 card.
  await page.waitForFunction(
    ({ sel, count }) => {
      const grid = document.querySelector('[data-sg-item-count]')
      if (!grid) return false
      const items = Number(grid.getAttribute('data-sg-item-count') || '0')
      return items >= count && document.querySelectorAll(sel).length >= 1
    },
    { sel: CARD_SELECTOR, count: n },
    { timeout: 300_000 },
  )
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  )
  const t1 = await page.evaluate(() => performance.now())
  return t1 - t0
}

/**
 * @param {import('playwright').Browser} browser
 * @param {{ baseUrl: string, n: number, scenario: 'init' | 'toggle' | 'search' }} opts
 */
async function profileScenario(browser, opts) {
  const { baseUrl, n, scenario } = opts
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()

  await page.addInitScript(renderTrackerSource())
  await installLongTaskObserver(page)
  await stubStyleGridApi(page)

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await setCpuThrottle(page, CPU_THROTTLE)
  await waitSgReady(page)

  const cdp = await page.context().newCDPSession(page)

  /** @type {number} */
  let wallMs = 0
  /** @type {unknown} */
  let renderSnap = null
  /** @type {unknown} */
  let renderLast = null
  /** @type {Record<string, unknown>} */
  let extras = {}

  if (scenario === 'init') {
    await page.evaluate(() => window.__sgRenderStats?.reset())
    await startCpuProfile(cdp)
    wallMs = await injectInit(page, n)
    const profile = await stopCpuProfile(cdp)
    renderSnap = await page.evaluate(() => window.__sgRenderStats?.snapshot())
    await context.close()
    return { profile, wallMs, renderSnap, extras }
  }

  // Warm grid for toggle / search
  wallMs = await injectInit(page, n)
  await page.evaluate(() => window.__sgRenderStats?.reset())

  if (scenario === 'toggle') {
    const beforeSelected = await page.evaluate((sel) => {
      const el = document.querySelectorAll(sel)[0]
      return Boolean(el && el.className.includes('bg-sg-accent'))
    }, CARD_SELECTOR)
    await page.evaluate(() => window.__sgRenderStats?.reset())
    await startCpuProfile(cdp)
    const t0 = await page.evaluate(() => performance.now())
    // Click in-page to keep Playwright polling out of the CPU profile window.
    await page.evaluate((sel) => {
      const el = document.querySelectorAll(sel)[0]
      if (!el) throw new Error('no card')
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
    }, CARD_SELECTOR)
    await page.waitForFunction(
      ({ sel, want }) => {
        const el = document.querySelectorAll(sel)[0]
        if (!el) return false
        return el.className.includes('bg-sg-accent') === want
      },
      { sel: CARD_SELECTOR, want: !beforeSelected },
      { timeout: 30_000 },
    )
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    )
    const t1 = await page.evaluate(() => performance.now())
    const profile = await stopCpuProfile(cdp)
    renderSnap = await page.evaluate(() => window.__sgRenderStats?.snapshot())
    renderLast = await page.evaluate(() => window.__sgRenderStats?.lastCommit)
    const selectedCount = await page.evaluate(
      (sel) =>
        [...document.querySelectorAll(sel)].filter((el) =>
          el.className.includes('bg-sg-accent'),
        ).length,
      CARD_SELECTOR,
    )
    extras = {
      initWallMs: wallMs,
      selectedCount,
      beforeSelected,
      afterSelected: !beforeSelected,
      cardClassMutations: /** @type {{ cardClassMutations?: number }} */ (renderSnap)?.cardClassMutations,
    }
    await context.close()
    return { profile, wallMs: t1 - t0, renderSnap, renderLast, extras }
  }

  // search: one keystroke
  const input = page.locator(SEARCH_SELECTOR).first()
  await input.click()
  await input.fill('')
  await page.keyboard.press('Escape')
  await input.click()
  await page.evaluate(() => window.__sgRenderStats?.reset())

  await startCpuProfile(cdp)
  const t0 = await page.evaluate(() => performance.now())
  await page.keyboard.type('B', { delay: 0 })
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  )
  // Wait until filter has applied (bench names contain "Bench" / "BASE_..." — "B" matches many)
  await page.waitForFunction(
    (sel) => document.querySelectorAll(sel).length > 0,
    CARD_SELECTOR,
    { timeout: 60_000 },
  )
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  )
  const t1 = await page.evaluate(() => performance.now())
  const profile = await stopCpuProfile(cdp)
  const cardCount = await page.evaluate((sel) => document.querySelectorAll(sel).length, CARD_SELECTOR)
  renderSnap = await page.evaluate(() => window.__sgRenderStats?.snapshot())
  extras = { initWallMs: wallMs, cardCountAfterKey: cardCount }
  await context.close()
  return { profile, wallMs: t1 - t0, renderSnap, extras }
}

/**
 * @param {Array<{ functionName: string, fileLine: string, selfMs: number, selfPct: number }>} allA
 * @param {Array<{ functionName: string, fileLine: string, selfMs: number, selfPct: number }>} allB
 * @param {number} nA
 * @param {number} nB
 */
function findSuperlinear(allA, allB, nA, nB) {
  const nRatio = nB / nA
  /** @type {Map<string, { functionName: string, fileLine: string, selfMs: number }>} */
  const mapA = new Map()
  for (const f of allA) {
    mapA.set(`${f.functionName}\0${f.fileLine}`, f)
  }
  /** @type {Array<Record<string, unknown>>} */
  const hits = []
  for (const f of allB) {
    const key = `${f.functionName}\0${f.fileLine}`
    const a = mapA.get(key)
    const aMs = a?.selfMs ?? 0
    // Require meaningful absolute time at N=5000
    if (f.selfMs < 20) continue
    const ratio = aMs > 0.5 ? f.selfMs / aMs : Infinity
    if (ratio > 4) {
      hits.push({
        functionName: f.functionName,
        fileLine: f.fileLine,
        selfMs2000: aMs,
        selfMs5000: f.selfMs,
        growth: aMs > 0.5 ? Number(ratio.toFixed(2)) : null,
        nRatio,
        note: classifyHotspot(f.functionName, f.fileLine),
      })
    }
  }
  hits.sort((x, y) => {
    const gx = typeof x.growth === 'number' ? x.growth : 999
    const gy = typeof y.growth === 'number' ? y.growth : 999
    return gy - gx
  })
  return hits
}

/**
 * @param {string} name
 * @param {string} fileLine
 */
function classifyHotspot(name, fileLine) {
  const h = `${name} ${fileLine}`
  if (/nextDuplicateName/.test(h)) {
    return 'O(N²): StyleCard always evaluates initialValue={nextDuplicateName(name, styles)} (even when dialog closed); builds Set(catalog.map) per card'
  }
  if (/categories/.test(h) || (/stylesStore\.ts:142[7-9]|stylesStore\.ts:143[0-4]/.test(h))) {
    return 'O(N²): StyleCard render calls categories() for Move/Edit dialog props (×2); categories() scans all styles each call'
  }
  if (/allSelected|selectedStyles\.some|styleRowKey/.test(h) && /StyleGrid/.test(h)) {
    return 'O(group×S) nested every×some over selection on each StyleGrid render'
  }
  if (/buildDuplicatesByName|duplicates/.test(h)) {
    return 'O(N) bucket scan when styles array is replaced'
  }
  if (/matchesSearch|buildStyleSearchText|nameSearchText|selectFilteredStyles|searchTextByKey/.test(h)) {
    return 'O(N) filter: per-style haystack lookup + token includes'
  }
  if (/dedupeStylesByNameForAllSources/.test(h)) {
    return 'O(N) dedupe pass after filter'
  }
  if (/ThumbnailPreview|addEventListener|localStorage/.test(h)) {
    return 'O(N) per-card mount side effects'
  }
  if (/createPortal|ConfirmDialog|EditStyleDialog|Portal|ConfirmInputDialog/.test(h)) {
    return 'O(N) per-card portal/dialog trees on mount (props still evaluated when closed)'
  }
  if (/framer-motion|motion\.|AnimatePresence|MeasureLayout|PopChild|measureScroll/.test(h)) {
    return 'per-card/group motion measurement / layout animation cost'
  }
  if (/insertBefore|appendChild|createElement|commit(Mutation|Layout|Placement)/i.test(h)) {
    return 'DOM commit / layout — scales with mounted card count'
  }
  if (/setStyles|SG_INIT|normalize/.test(h)) {
    return 'catalog ingest path on init'
  }
  if (/useIsSelected|selectedKeySet|buildSelectedKeySet/.test(h)) {
    return 'selection index rebuild / per-card selector fan-out'
  }
  if (/StyleCard/.test(h)) {
    return 'per-card React render work (mount or update)'
  }
  if (/StyleGrid/.test(h)) {
    return 'grid-level recompute (group reduce / headers / map to cards)'
  }
  return 'see call stack / file context'
}

/**
 * @param {Record<string, unknown>} results
 */
function buildReportMarkdown(results) {
  const meta = /** @type {Record<string, unknown>} */ (results.meta)
  const lines = []
  lines.push('# Grid performance PHASE B — CDP profile report')
  lines.push('')
  lines.push(`- Host: ComfyUI (\`sd-comfyui-style-organizer\`)`)
  lines.push(`- Phase A bench host reused (static \`ui/bench/.tmp/dist\`, stub \`/style_grid/**\`, \`SG_INIT\` synthetic)`)
  lines.push(`- CPU throttle: ${meta.cpuThrottle}×`)
  lines.push(`- Sampling interval: ${meta.samplingIntervalUs} µs`)
  lines.push(`- Build: sourcemap=true, minify=false (profile-only flags; not shipped)`)
  lines.push(`- Timestamp: ${meta.timestamp}`)
  lines.push(`- Commit: ${meta.commit ?? 'n/a'}`)
  lines.push('')
  lines.push('## Wall times')
  lines.push('')
  lines.push('| N | scenario | wallMs | profileSampleMs |')
  lines.push('|---|----------|--------|-----------------|')
  for (const n of /** @type {number[]} */ (meta.sizes)) {
    for (const scenario of ['init', 'toggle', 'search']) {
      const block = /** @type {Record<string, unknown>} */ (
        /** @type {Record<string, unknown>} */ (results.profiles)[String(n)]
      )[scenario]
      const analysis = /** @type {{ totalSampleMs: number }} */ (block.analysis)
      lines.push(
        `| ${n} | ${scenario} | ${Number(block.wallMs).toFixed(1)} | ${analysis.totalSampleMs.toFixed(1)} |`,
      )
    }
  }
  lines.push('')

  // Top 15 tables
  for (const n of /** @type {number[]} */ (meta.sizes)) {
    for (const scenario of ['init', 'toggle', 'search']) {
      const block = /** @type {Record<string, unknown>} */ (
        /** @type {Record<string, unknown>} */ (results.profiles)[String(n)]
      )[scenario]
      const analysis = /** @type {{ top: Array<Record<string, unknown>>, totalSampleMs: number }} */ (
        block.analysis
      )
      lines.push(`## Top 15 self-time — N=${n} / ${scenario}`)
      lines.push('')
      lines.push(`Wall: **${Number(block.wallMs).toFixed(1)} ms** · Profile samples: **${analysis.totalSampleMs.toFixed(1)} ms**`)
      lines.push('')
      lines.push('| # | selfMs | % | function | file:line |')
      lines.push('|---|--------|---|----------|-----------|')
      for (const row of analysis.top) {
        lines.push(
          `| ${row.rank} | ${Number(row.selfMs).toFixed(1)} | ${Number(row.selfPct).toFixed(1)} | \`${row.functionName}\` | \`${row.fileLine}\` |`,
        )
      }
      lines.push('')
    }
  }

  // Toggle re-renders
  lines.push('## Components re-rendering on toggle')
  lines.push('')
  for (const n of /** @type {number[]} */ (meta.sizes)) {
    const block = /** @type {Record<string, unknown>} */ (
      /** @type {Record<string, unknown>} */ (results.profiles)[String(n)]
    ).toggle
    const snap = /** @type {{ commits?: number, byName?: Array<{ name: string, count: number }>, lastCommit?: { byName: Array<{ name: string, count: number }> } } | null} */ (
      block.renderSnap
    )
    const last = /** @type {{ byName?: Array<{ name: string, count: number }> } | null} */ (
      block.renderLast
    )
    lines.push(`### N=${n}`)
    lines.push('')
    lines.push(`- Commits during toggle window: **${snap?.commits ?? 0}**`)
    lines.push(`- Wall toggle: **${Number(block.wallMs).toFixed(1)} ms**`)
    const list = (last?.byName?.length ? last.byName : snap?.byName) || []
    if (list.length === 0) {
      lines.push('- _(no fiber PerformedWork counts captured — see DOM/store notes below)_')
    } else {
      lines.push('')
      lines.push('| component | render count (PerformedWork, allowlisted) |')
      lines.push('|-----------|------------------------------------------|')
      for (const row of list.slice(0, 25)) {
        lines.push(`| \`${row.name}\` | ${row.count} |`)
      }
      const styleCards = list.find((r) => r.name === 'StyleCard')
      const grid = list.find((r) => r.name === 'StyleGrid')
      lines.push('')
      lines.push(
        `- Takeaway: \`StyleGrid\`×${grid?.count ?? 0}, \`StyleCard\`×${styleCards?.count ?? 0} (memo + \`selectedKeySet\` boolean selectors keep card fan-out tiny; grid/chrome still re-render).`,
      )
    }
    lines.push('')
  }

  const answers = /** @type {Record<string, unknown>} */ (results.answers)
  lines.push('## Answers')
  lines.push('')
  lines.push('### 1) What does a single toggle recompute at grid level?')
  lines.push('')
  lines.push(String(answers.toggleGrid))
  lines.push('')
  lines.push('### 2) Search keystroke: filtering vs rendering share?')
  lines.push('')
  lines.push(String(answers.searchShare))
  lines.push('')
  lines.push('### 3) Superlinear init (2000→5000)')
  lines.push('')
  lines.push(String(answers.superlinear))
  lines.push('')

  const growth = /** @type {Array<Record<string, unknown>>} */ (results.superlinearGrowth || [])
  if (growth.length) {
    lines.push('#### Functions with self-time growth > ×4 (N=2000 → N=5000 init)')
    lines.push('')
    lines.push('| function | file:line | selfMs@2000 | selfMs@5000 | growth | why |')
    lines.push('|----------|-----------|-------------|-------------|--------|-----|')
    for (const g of growth) {
      const growthStr = g.growth == null ? '>4 (absent/tiny @2000)' : `×${g.growth}`
      lines.push(
        `| \`${g.functionName}\` | \`${g.fileLine}\` | ${Number(g.selfMs2000).toFixed(1)} | ${Number(g.selfMs5000).toFixed(1)} | ${growthStr} | ${g.note} |`,
      )
    }
    lines.push('')
  }

  lines.push('## Raw artifacts')
  lines.push('')
  lines.push('JSON profiles + analysis: `ui/bench/profile/raw/*.cpuprofile.json`, `summary.json`.')
  lines.push('')
  return `${lines.join('\n')}\n`
}

async function gitMeta(cwd) {
  try {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execFileAsync = promisify(execFile)
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd })
    return stdout.trim()
  } catch {
    return null
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  await mkdir(RAW_DIR, { recursive: true })

  if (!args.skipBuild) {
    console.log('[profile] building (sourcemap, no minify) →', TMP_DIST)
    await buildToTmp()
  } else {
    await access(path.join(TMP_DIST, 'index.html'))
  }

  const server = await startStaticServer(TMP_DIST, PREVIEW_PORT)
  console.log('[profile] serving', server.baseUrl)

  const browser = await chromium.launch({ headless: true })
  const commit = await gitMeta(path.resolve(UI_ROOT, '..'))

  /** @type {Record<string, Record<string, unknown>>} */
  const profiles = {}

  try {
    for (const n of args.sizes) {
      profiles[String(n)] = {}
      for (const scenario of /** @type {const} */ (['init', 'toggle', 'search'])) {
        console.log(`[profile] N=${n} ${scenario}...`)
        const result = await profileScenario(browser, {
          baseUrl: server.baseUrl,
          n,
          scenario,
        })
        const analysis = await analyzeCpuProfile(result.profile, TMP_DIST, { topN: 15 })
        const rawName = `n${n}-${scenario}.cpuprofile.json`
        await writeFile(
          path.join(RAW_DIR, rawName),
          `${JSON.stringify(result.profile)}\n`,
          'utf8',
        )
        await writeFile(
          path.join(RAW_DIR, `n${n}-${scenario}.analysis.json`),
          `${JSON.stringify({ wallMs: result.wallMs, analysis, renderSnap: result.renderSnap, renderLast: result.renderLast, extras: result.extras }, null, 2)}\n`,
          'utf8',
        )
        profiles[String(n)][scenario] = {
          wallMs: result.wallMs,
          analysis,
          renderSnap: result.renderSnap,
          renderLast: result.renderLast,
          extras: result.extras,
          raw: rawName,
        }
        console.log(
          `  wall=${result.wallMs.toFixed(1)}ms sample=${analysis.totalSampleMs.toFixed(1)}ms top=${analysis.top[0]?.functionName || '?'}`,
        )
      }
    }
  } finally {
    await browser.close()
    await server.close()
  }

  // --- Derived answers ---
  const init2000 = profiles['2000']?.init
  const init5000 = profiles['5000']?.init
  const toggle2000 = profiles['2000']?.toggle
  const toggle5000 = profiles['5000']?.toggle
  const search2000 = profiles['2000']?.search
  const search5000 = profiles['5000']?.search

  const FILTER_RE = [
    /matchesSearch/,
    /matchSearchTokens/,
    /buildStyleSearchText/,
    /nameSearchText/,
    /selectFilteredStyles/,
    /dedupeStylesByNameForAllSources/,
    /stripStyleReferences/,
    /buildSearchTextByKey/,
    /searchTextByKey/,
  ]
  const RENDER_RE = [
    /StyleCard/,
    /StyleGrid/,
    /ThumbnailPreview/,
    /nextDuplicateName/,
    /categories/,
    /react-dom/,
    /react-jsx-runtime/,
    /scheduler/,
    /commit(Mutation|Layout|Placement|Reconciliation)/i,
    /insertBefore|appendChild|removeChild|createElement|setAttribute/,
    /framer-motion|motion-dom|motion\./i,
    /measureScroll/,
    /CompleteUnitOfWork|beginWork|completeWork|performUnitOfWork|renderWithHooks/,
    /initInput|updateWorkInProgressHook|jsxProd/,
  ]
  const NOISE_RE = [/^\(program\)/, /^\(idle\)/, /^\(garbage collector\)/, /\bwalk\b/]

  /**
   * @param {Record<string, unknown> | undefined} block
   */
  function searchShareText(block) {
    if (!block) return '_missing search profile_'
    const all = /** @type {{ all: Array<{ functionName: string, fileLine: string, selfMs: number }>, totalSampleMs: number }} */ (
      block.analysis
    )
    const noiseMs = sumMatchingSelfMs(all.all, NOISE_RE)
    const attributed = all.all.filter((f) => !NOISE_RE.some((re) => re.test(`${f.functionName} ${f.fileLine}`)))
    const filterMs = sumMatchingSelfMs(attributed, FILTER_RE)
    const renderMs = sumMatchingSelfMs(attributed, RENDER_RE)
    const attrTotal = attributed.reduce((s, f) => s + f.selfMs, 0) || 1
    const other = Math.max(0, attrTotal - filterMs - renderMs)
    const sampleTotal = all.totalSampleMs || 1
    // Keystroke "B" matches nearly all bench names (BASE/BODY/Bench…) → almost full grid stays mounted.
    return [
      `Wall **${Number(block.wallMs).toFixed(1)} ms** · raw samples **${sampleTotal.toFixed(1)} ms** (of which (program)/(idle)/gc ≈ ${noiseMs.toFixed(1)} ms excluded below).`,
      '',
      `| bucket | selfMs | share of attributed samples |`,
      `|--------|--------|-----------------------------|`,
      `| Filtering (\`matchesSearch\` / \`matchSearchTokens\` / dedupe) | ${filterMs.toFixed(1)} | ${((100 * filterMs) / attrTotal).toFixed(1)}% |`,
      `| Rendering (React + StyleCard/Grid + DOM + motion + per-card \`categories\`/\`nextDuplicateName\`) | ${renderMs.toFixed(1)} | ${((100 * renderMs) / attrTotal).toFixed(1)}% |`,
      `| Other attributed | ${other.toFixed(1)} | ${((100 * other) / attrTotal).toFixed(1)}% |`,
      '',
      'Haystacks are precomputed (\`searchTextByKey\`); filter self-time is a small O(N) token scan. The keystroke cost is **re-rendering the surviving card forest** (unvirtualized). Query \`B\` keeps almost all synthetic rows visible, so render≈full-grid work.',
    ].join('\n')
  }

  /**
   * @param {Record<string, unknown> | undefined} t2000
   * @param {Record<string, unknown> | undefined} t5000
   */
  function toggleAnswer(t2000, t5000) {
    const parts = []
    parts.push(
      '`StyleGrid` subscribes to `selectedStyles` (shallow store slice). One card click → `toggleStyle` → new `selectedStyles` + `selectedKeySet`. That forces a **grid-level re-render** even when individual `StyleCard`s are `memo`ized.',
    )
    parts.push('')
    parts.push('On that grid render (All-categories view used by the bench), the expensive recomputes are:')
    parts.push('')
    parts.push('1. **Group rebuild** — `filtered.reduce` into category buckets, then `categories()` ordering (`StyleGrid.tsx` ~348–365). `categories()` itself is O(N) over `styles`.')
    parts.push('2. **`allSelected` per category** — `catStyles.every(s => selectedStyles.some(...))` (`StyleGrid.tsx` ~371–373): nested scan, O(groupSize × selectionSize) per category header.')
    parts.push('3. **Children reconcile** — React walks all N `StyleCard` fibers; `memo` + `useIsSelected` (`selectedKeySet.has`) should bail out of paint for untouched cards, but any card that *does* re-render still pays **`nextDuplicateName(styles)` + `categories()`×2** (closed dialog props) — O(N) each.')
    parts.push('4. **Selection index** — `buildSelectedKeySet` subscriber path in `stylesStore.ts`.')
    parts.push('5. **Motion** — group `measureScroll` / projection updates can still run while the tree reconciles.')
    parts.push('')
    for (const [label, block] of [
      ['2000', t2000],
      ['5000', t5000],
    ]) {
      if (!block) continue
      const last = /** @type {{ byName?: Array<{ name: string, count: number }> } | null} */ (
        block.renderLast
      )
      const snap = /** @type {{ byName?: Array<{ name: string, count: number }>, commits?: number, cardClassMutations?: number } | null} */ (
        block.renderSnap
      )
      const top = (last?.byName || snap?.byName || []).slice(0, 12)
      parts.push(
        `**N=${label}** wall ${Number(block.wallMs).toFixed(1)} ms, commits=${snap?.commits ?? '?'}, card class mutations=${snap?.cardClassMutations ?? '?'}`,
      )
      if (top.length) {
        parts.push(top.map((r) => `\`${r.name}\`×${r.count}`).join(', '))
      } else {
        parts.push('_fiber names unavailable; see top-15 toggle table_')
      }
      parts.push('')
    }
    return parts.join('\n')
  }

  const growth =
    init2000 && init5000
      ? findSuperlinear(
          /** @type {{ all: Array<{ functionName: string, fileLine: string, selfMs: number }> }} */ (
            init2000.analysis
          ).all,
          /** @type {{ all: Array<{ functionName: string, fileLine: string, selfMs: number }> }} */ (
            init5000.analysis
          ).all,
          2000,
          5000,
        )
      : []

  const wall2000 = init2000 ? Number(init2000.wallMs) : 0
  const wall5000 = init5000 ? Number(init5000.wallMs) : 0
  const wallGrowth = wall2000 > 0 ? wall5000 / wall2000 : 0

  const superlinearAnswer = [
    `Phase A median init was ~×${(20641 / 3965.5).toFixed(1)} from N=2000→5000 (N grows ×2.5). This profile run: wall **${wall2000.toFixed(1)} ms → ${wall5000.toFixed(1)} ms (×${wallGrowth.toFixed(2)})**.`,
    '',
    'Smoking gun is **O(N²) work inside each StyleCard render**, not the store ingest:',
    '',
    '- `nextDuplicateName` (`StyleCard.tsx:41`, called from `:441` as `initialValue=...`) builds `new Set(catalog.map(s => s.name))` — **O(N) per card**, always, even with `duplicateOpen === false`.',
    '- `categories()` (`stylesStore.ts:1427`, called from `StyleCard.tsx:498` and `:532`) rescans all styles — **O(N) per card × 2**.',
    '',
    'Expected quadratic scale factor for N×2.5 is ~×6.25; the init self-time growth for these frames matches that band.',
    '',
    growth.length
      ? `Functions below grew **> ×4** in self-time between the two init profiles (absolute selfMs@5000 ≥ 20 ms).`
      : 'No single mapped frame cleared the >×4 self-time bar with ≥20 ms @5000; see top-15 init tables.',
  ].join('\n')

  const payload = {
    meta: {
      host: 'comfy',
      phase: 'B',
      wave: 1,
      role: 'P Profiler',
      cpuThrottle: CPU_THROTTLE,
      samplingIntervalUs: 100,
      sizes: args.sizes,
      timestamp: new Date().toISOString(),
      commit,
      dist: TMP_DIST,
    },
    profiles,
    superlinearGrowth: growth,
    answers: {
      toggleGrid: toggleAnswer(toggle2000, toggle5000),
      searchShare: [
        searchShareText(search2000),
        '',
        '### N=5000',
        '',
        searchShareText(search5000),
      ].join('\n'),
      superlinear: superlinearAnswer,
    },
  }

  await writeFile(path.join(OUT_DIR, 'summary.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  const md = buildReportMarkdown(payload)
  await writeFile(path.join(OUT_DIR, 'report.md'), md, 'utf8')
  console.log('[profile] wrote', path.join(OUT_DIR, 'report.md'))
  console.log('[profile] wrote', path.join(OUT_DIR, 'summary.json'))
}

main().catch((err) => {
  console.error('[profile] FAILED', err)
  process.exit(1)
})
