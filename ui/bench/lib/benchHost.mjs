/**
 * Shared Playwright host helpers for ComfyUI layout + perf benches.
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { access, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeBenchScenario } from './synthetic.mjs'
import { stubStyleGridApi } from './stubApi.mjs'
import { installLongTaskObserver } from './measure.mjs'
import { CARD_SELECTOR } from './layoutInvariants.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const BENCH_ROOT = path.resolve(__dirname, '..')
export const UI_ROOT = path.resolve(BENCH_ROOT, '..')
export const TMP_DIST = path.join(BENCH_ROOT, '.tmp', 'dist')

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd: string }} opts
 */
export function runCmd(command, args, opts) {
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

export async function buildToTmp() {
  await mkdir(path.dirname(TMP_DIST), { recursive: true })
  const viteJs = path.join(UI_ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
  await runCmd(
    process.execPath,
    [viteJs, 'build', '--outDir', path.relative(UI_ROOT, TMP_DIST), '--emptyOutDir'],
    { cwd: UI_ROOT },
  )
  await access(path.join(TMP_DIST, 'index.html'))
}

/**
 * @param {string} root
 * @param {number} port
 */
export async function startStaticServer(root, port) {
  function contentType(p) {
    if (p.endsWith('.html')) return 'text/html; charset=utf-8'
    if (p.endsWith('.js')) return 'text/javascript; charset=utf-8'
    if (p.endsWith('.css')) return 'text/css; charset=utf-8'
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
      res.writeHead(200, {
        'Content-Type': contentType(filePath),
        'Cache-Control': 'no-store',
      })
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

/** Fake iframe so App toggleFullscreen can flip windowed. */
export async function installFakeIframe(page) {
  await page.evaluate(() => {
    if (document.getElementById('sg-fake-frame-host')) return
    const host = document.createElement('div')
    host.id = 'sg-fake-frame-host'
    Object.assign(host.style, {
      position: 'fixed',
      inset: '0',
      display: 'flex',
      flexDirection: 'column',
    })
    const frame = document.createElement('div')
    frame.id = 'sg-fake-frame'
    Object.assign(frame.style, {
      flex: '1',
      minHeight: '0',
      display: 'flex',
      flexDirection: 'column',
    })
    host.appendChild(frame)
    const root = document.getElementById('root')
    document.body.prepend(host)
    if (root) frame.appendChild(root)
    Object.defineProperty(window, 'frameElement', {
      configurable: true,
      get: () => frame,
    })
  })
}

/**
 * @param {import('playwright').Page} page
 * @param {number} n
 */
export async function waitCatalog(page, n) {
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
}

/**
 * @param {import('playwright').Page} page
 * @param {string} density
 */
export async function setDensity(page, density) {
  const isFs = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')]
    return buttons.some((b) =>
      (b.getAttribute('aria-label') || '').includes('Exit fullscreen'),
    )
  })
  if (isFs) {
    await page.getByRole('button', { name: 'Exit fullscreen' }).click()
    await page.waitForTimeout(100)
  }

  const compactActive = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(
      (b) => (b.getAttribute('aria-label') || '') === 'Compact mode',
    )
    return btn?.getAttribute('aria-pressed') === 'true'
  })

  const wantCompact = density === 'compact' || density === 'compact-windowed'
  if (compactActive !== wantCompact) {
    await page.getByRole('button', { name: 'Compact mode' }).click()
    await page.waitForTimeout(100)
  }

  const wantFullscreen = density === 'normal' || density === 'compact'
  if (wantFullscreen) {
    await page.getByRole('button', { name: 'Fullscreen' }).click()
    await page.waitForTimeout(150)
  }
}

export async function scrollThreeScreens(page) {
  await page.evaluate(async () => {
    const grid = document.querySelector('[data-sg-item-count]')
    const scrollEl = grid?.parentElement
    if (!scrollEl) throw new Error('no scroll')
    const pageH = scrollEl.clientHeight
    scrollEl.scrollTop = pageH * 3
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  })
}

/**
 * Open a fresh page, seed realistic scenario, wait for catalog.
 * @param {import('playwright').Browser} browser
 * @param {{
 *   baseUrl: string
 *   n: number
 *   favorites?: string[]
 *   seedSelected?: boolean
 * }} opts
 */
export async function openBenchPage(browser, opts) {
  const scenario = makeBenchScenario(opts.n)
  const favorites = opts.favorites ?? scenario.favorites
  const styles = scenario.styles

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()

  await page.addInitScript((favs) => {
    try {
      localStorage.setItem('sg_v2_favorites', JSON.stringify(favs))
    } catch {
      // ignore
    }
  }, favorites)

  await installLongTaskObserver(page)
  await stubStyleGridApi(page)
  await page.goto(opts.baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForFunction(() => Boolean(window.__sgBench?.ready), null, {
    timeout: 60_000,
  })
  await installFakeIframe(page)

  await page.evaluate((payload) => {
    window.postMessage({ type: 'SG_INIT', styles: payload }, '*')
  }, styles)
  // All-sources dedupes by name → wait on uniqueNameCount, not raw N.
  await waitCatalog(page, scenario.uniqueNameCount)

  if (opts.seedSelected !== false) {
    const cards = page.locator(CARD_SELECTOR)
    const count = Math.min(scenario.selected.length, await cards.count())
    for (let i = 0; i < count; i += 1) {
      await cards.nth(i).click()
    }
  }

  return { context, page, scenario }
}
