#!/usr/bin/env node
/**
 * MENU clamp probe (ComfyUI) — same matrix as WebUI MENU-DIAG:
 *   density × with/without thumbnail × {contextMenu, sourcePicker}
 * All cases: scroll 3 scroller screens, open on bottom-right visible card.
 *
 * READ-ONLY ui/src. Writes only under ui/bench/menu/.
 *
 * Usage (from ui/):
 *   node bench/menu/run.mjs
 *   node bench/menu/run.mjs --skip-build
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createReadStream, writeFileSync, mkdirSync } from 'node:fs'
import { access, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { makeMenuSyntheticStyles } from './syntheticMenu.mjs'
import {
  MENU_MARGIN,
  checkMenuInsideViewport,
} from './assertInsideViewport.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UI_ROOT = path.resolve(__dirname, '../..')
const BENCH_ROOT = path.resolve(__dirname, '..')
const TMP_DIST = path.join(BENCH_ROOT, '.tmp', 'dist')
const OUT_DIR = path.join(__dirname, 'out')
const RAW_JSON = path.join(OUT_DIR, 'menu-probe.raw.json')
const REPORT_MD = path.join(__dirname, 'report.md')
const PORT = 4191
const VIEWPORT = { width: 1280, height: 800 }
const N = 500
const DENSITIES = Object.freeze(['compact', 'normal', 'windowed'])
const CARD_SELECTOR = '[data-sg-card="true"]'

/** Tiny 1×1 WebP for thumbnail GETs when probing withThumb. */
const TINY_WEBP = Buffer.from(
  'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA',
  'base64',
)

const CLAMP_NOTES = {
  contextMenu: {
    portal: true,
    clampAssumedHeight: null,
    clampAssumedHeightFileLine: 'StyleCard.tsx:142-145,203 — raw clientX/clientY, no fit',
    note: 'Portals to document.body; no fitFixedMenuPosition',
  },
  sourcePicker: {
    portal: true,
    clampAssumedHeight: null,
    clampAssumedWidth: 280,
    clampAssumedHeightFileLine: 'StyleCard.tsx:150-153 — top=max(8,rect.top) only',
    clampAssumedWidthFileLine: 'StyleCard.tsx:151 — min(rect.right+8, innerWidth-280)',
    note: 'Portals to document.body; X assumed width 280; no bottom flip',
  },
  fitHelper: {
    fileLine: 'fitFixedMenuPosition.ts:2,9-39',
    pad: 'MENU_VIEWPORT_PAD=8',
    note: 'Used by ViewportFixedMenu only (not StyleCard menu/picker)',
  },
  transformedRows: {
    fileLine: 'VirtualStyleGrid.tsx:243',
    note: 'Non-sticky rows use transform:translateY — escaped by body portal',
  },
}

function parseArgs(argv) {
  const out = { skipBuild: false, n: N, headed: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--skip-build') out.skipBuild = true
    else if (a === '--n') out.n = Math.max(50, Number(argv[++i]) || N)
    else if (a === '--headed') out.headed = true
  }
  return out
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

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
  await runCmd(
    process.execPath,
    [viteJs, 'build', '--outDir', path.relative(UI_ROOT, TMP_DIST), '--emptyOutDir'],
    { cwd: UI_ROOT },
  )
  await access(path.join(TMP_DIST, 'index.html'))
}

async function startStaticServer(root, port) {
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
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve(undefined)))
      }),
  }
}

async function installFakeIframe(page) {
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
 * Comfy loadThumbnails ignores bare name strings — needs {name, source_file}.
 * @param {import('playwright').Page} page
 * @param {ReturnType<typeof makeMenuSyntheticStyles>} styles
 * @param {boolean} withThumb
 */
async function stubApi(page, styles, withThumb) {
  await page.route('**/style_grid/**', async (route) => {
    const url = route.request().url()
    const method = route.request().method().toUpperCase()

    if (url.includes('/style_grid/thumbnails/list')) {
      const has_thumbnail = withThumb
        ? styles.map((s) => ({ name: s.name, source_file: s.source_file }))
        : []
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ has_thumbnail }),
      })
      return
    }
    if (url.includes('/style_grid/thumbnail') && method === 'GET') {
      if (withThumb) {
        await route.fulfill({
          status: 200,
          contentType: 'image/webp',
          body: TINY_WEBP,
        })
      } else {
        await route.fulfill({ status: 404, body: '' })
      }
      return
    }
    if (url.includes('/style_grid/thumbnail') && method === 'DELETE') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      })
      return
    }
    if (url.includes('/style_grid/usage') && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{}',
      })
      return
    }
    if (url.includes('/style_grid/presets')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{}',
      })
      return
    }
    if (url.includes('/style_grid/category_order') && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '[]',
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  })
}

async function waitCatalog(page, n) {
  // All-Sources dedupe → unique names ≈ n/2
  const want = Math.floor(n / 2) - 5
  await page.waitForFunction(
    ({ sel, count }) => {
      const grid = document.querySelector('[data-sg-item-count]')
      if (!grid) return false
      const items = Number(grid.getAttribute('data-sg-item-count') || '0')
      return items >= count && document.querySelectorAll(sel).length >= 1
    },
    { sel: CARD_SELECTOR, count: want },
    { timeout: 180_000 },
  )
}

/**
 * @param {import('playwright').Page} page
 * @param {'compact'|'normal'|'windowed'} density
 */
async function setDensity(page, density) {
  const isFs = await page.evaluate(() =>
    [...document.querySelectorAll('button')].some((b) =>
      (b.getAttribute('aria-label') || '').includes('Exit fullscreen'),
    ),
  )
  if (isFs) {
    await page.getByRole('button', { name: 'Exit fullscreen' }).click()
    await sleep(100)
  }

  const compactActive = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(
      (b) => (b.getAttribute('aria-label') || '') === 'Compact mode',
    )
    return btn?.getAttribute('aria-pressed') === 'true'
  })
  const wantCompact = density === 'compact'
  if (compactActive !== wantCompact) {
    await page.getByRole('button', { name: 'Compact mode' }).click()
    await sleep(100)
  }

  if (density === 'normal') {
    await page.getByRole('button', { name: 'Fullscreen' }).click()
    await sleep(150)
  }
}

async function scrollScreens(page, screens = 3) {
  return page.evaluate((n) => {
    const grid = document.querySelector('[data-sg-item-count]')
    const scroller = grid?.parentElement
    if (!scroller) return null
    scroller.scrollTop = scroller.clientHeight * n
    return {
      scrollTop: scroller.scrollTop,
      clientHeight: scroller.clientHeight,
      scrollHeight: scroller.scrollHeight,
    }
  }, screens)
}

async function ensureAllSources(page) {
  await page.evaluate(() => {
    try {
      localStorage.removeItem('sg_v2_last_source')
    } catch {
      // ignore
    }
    const select = document.querySelector('select')
    if (!(select instanceof HTMLSelectElement)) return
    const proto = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      'value',
    )?.set
    proto?.call(select, '')
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await sleep(120)
}

async function findBottomRightCard(page) {
  return page.evaluate((sel) => {
    const vh = window.innerHeight
    const vw = window.innerWidth
    const cards = [...document.querySelectorAll(sel)]
      .map((el) => {
        const r = el.getBoundingClientRect()
        return {
          el,
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
          name: (el.getAttribute('title') || '').split('\n')[0] || '',
          visible:
            r.width > 0 &&
            r.height > 0 &&
            r.bottom > 4 &&
            r.top < vh - 4 &&
            r.right > 0 &&
            r.left < vw,
        }
      })
      .filter((c) => c.visible)
    if (!cards.length) return null
    // Prefer the lowest row that still has a clickable interior above vh-4.
    const maxBottom = Math.max(...cards.map((c) => Math.min(c.bottom, vh - 2)))
    const row = cards.filter((c) => Math.abs(Math.min(c.bottom, vh - 2) - maxBottom) < 3)
    const maxRight = Math.max(...row.map((c) => c.right))
    const pick = row.find((c) => Math.abs(c.right - maxRight) < 3) || row[0]
    for (const c of cards) c.el.removeAttribute('data-sg-menu-anchor')
    pick.el.setAttribute('data-sg-menu-anchor', '1')
    // Clamp click into the visible intersection (fullscreen cards may sit
    // partially past the bottom edge — elementFromPoint rejects y >= vh).
    const cx = Math.min(Math.max(pick.left + pick.width / 2, pick.left + 2), pick.right - 2)
    const cy = Math.min(
      Math.max(pick.top + pick.height / 2, pick.top + 2),
      Math.min(pick.bottom - 2, vh - 2),
    )
    return {
      name: pick.name,
      rect: {
        left: pick.left,
        top: pick.top,
        right: pick.right,
        bottom: pick.bottom,
        width: pick.width,
        height: pick.height,
      },
      anchor: { x: cx, y: cy },
      visibleCount: cards.length,
    }
  }, CARD_SELECTOR)
}

async function dismissMenus(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.fixed.inset-0').forEach((el) => {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  })
  await sleep(40)
}

/**
 * @param {import('playwright').Page} page
 * @param {'contextMenu'|'sourcePicker'} kind
 */
async function measureOpenMenu(page, kind) {
  return page.evaluate(
    ({ kind: k, margin }) => {
      const vw = window.innerWidth
      const vh = window.innerHeight
      const viewport = { width: vw, height: vh }

      /** @param {Element} el */
      function transformAncestors(el) {
        /** @type {Array<{tag:string,id:string,transform:string}>} */
        const out = []
        let n = /** @type {Element | null} */ (el)
        while (n && n !== document.documentElement) {
          const cs = getComputedStyle(n)
          if (cs.transform && cs.transform !== 'none') {
            out.push({
              tag: n.tagName,
              id: n.id || '',
              transform: cs.transform,
            })
          }
          n = n.parentElement
        }
        return out
      }

      /** @param {HTMLElement} el */
      function isBackdrop(el) {
        return (el.className || '').includes('inset-0')
      }

      let panel = null
      if (k === 'contextMenu') {
        panel = [...document.body.querySelectorAll('div.fixed')].find((el) => {
          if (!(el instanceof HTMLElement) || isBackdrop(el)) return false
          if (getComputedStyle(el).position !== 'fixed') return false
          return (el.textContent || '').includes('Copy prompt')
        })
      } else {
        panel = [...document.body.querySelectorAll('div.fixed')].find((el) => {
          if (!(el instanceof HTMLElement) || isBackdrop(el)) return false
          if (getComputedStyle(el).position !== 'fixed') return false
          const t = el.textContent || ''
          if (t.includes('Copy prompt')) return false
          const z = Number(getComputedStyle(el).zIndex) || 0
          if (z < 10005) return false
          return el.querySelectorAll('button').length >= 1
        })
      }

      if (!panel || !(panel instanceof HTMLElement)) {
        return {
          found: false,
          viewport,
          fullyInsideViewport: false,
          fullyInsideWithMenuMargin: false,
          overflowPx: { left: 0, top: 0, right: 0, bottom: 0 },
          overflowPxVsMargin8: { left: 0, top: 0, right: 0, bottom: 0 },
        }
      }

      const rect = panel.getBoundingClientRect()
      const menuRect = {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      }
      const overflowPx = {
        left: Math.max(0, -menuRect.left),
        top: Math.max(0, -menuRect.top),
        right: Math.max(0, menuRect.right - vw),
        bottom: Math.max(0, menuRect.bottom - vh),
      }
      const overflowPxVsMargin8 = {
        left: Math.max(0, margin - menuRect.left),
        top: Math.max(0, margin - menuRect.top),
        right: Math.max(0, menuRect.right - (vw - margin)),
        bottom: Math.max(0, menuRect.bottom - (vh - margin)),
      }
      const styleLeft = parseFloat(panel.style.left || '0')
      const styleTop = parseFloat(panel.style.top || '0')
      const text = panel.textContent || ''

      return {
        found: true,
        viewport,
        menuRect,
        overflowPx,
        overflowPxVsMargin8,
        fullyInsideViewport:
          overflowPx.left === 0 &&
          overflowPx.top === 0 &&
          overflowPx.right === 0 &&
          overflowPx.bottom === 0,
        fullyInsideWithMenuMargin:
          overflowPxVsMargin8.left === 0 &&
          overflowPxVsMargin8.top === 0 &&
          overflowPxVsMargin8.right === 0 &&
          overflowPxVsMargin8.bottom === 0,
        portaledToBody: panel.parentElement === document.body,
        transformAncestorChain: transformAncestors(panel),
        fixedOffset: {
          styleLeft,
          styleTop,
          rectLeft: menuRect.left,
          rectTop: menuRect.top,
          offsetX: menuRect.left - styleLeft,
          offsetY: menuRect.top - styleTop,
        },
        buttonCount: panel.querySelectorAll('button').length,
        hasDeletePreview:
          text.includes('Delete preview') || text.includes('Remove preview'),
      }
    },
    { kind, margin: MENU_MARGIN },
  )
}

async function probeContextMenu(page, anchor) {
  await dismissMenus(page)
  await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y)
    const card = el?.closest?.('[data-sg-card="true"]')
    if (!card) throw new Error(`no card at ${x},${y}`)
    card.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 2,
        view: window,
      }),
    )
  }, anchor)
  await sleep(150)
  const measure = await measureOpenMenu(page, 'contextMenu')
  await dismissMenus(page)
  return measure
}

async function probeSourcePicker(page, anchor) {
  await dismissMenus(page)
  await ensureAllSources(page)
  await page.evaluate(({ x, y }) => {
    const card = document.elementFromPoint(x, y)?.closest?.('[data-sg-card="true"]')
    if (!card) throw new Error(`no card at ${x},${y}`)
    // Deselect if already selected so the next click opens the picker.
    if (card.className.includes('bg-sg-accent')) {
      card.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          view: window,
        }),
      )
    }
    card.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        view: window,
      }),
    )
  }, anchor)
  await sleep(150)
  let measure = await measureOpenMenu(page, 'sourcePicker')
  if (!measure.found) {
    await page.evaluate(({ x, y }) => {
      const card = document.elementFromPoint(x, y)?.closest?.('[data-sg-card="true"]')
      card?.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          view: window,
        }),
      )
    }, anchor)
    await sleep(150)
    measure = await measureOpenMenu(page, 'sourcePicker')
  }
  await dismissMenus(page)
  return measure
}

function fmtOverflow(o) {
  if (!o) return '—'
  return `L${o.left.toFixed(1)} T${o.top.toFixed(1)} R${o.right.toFixed(1)} B${o.bottom.toFixed(1)}`
}

function fmtRect(r) {
  if (!r) return '—'
  return `${r.left.toFixed(1)},${r.top.toFixed(1)} ${r.width.toFixed(1)}×${r.height.toFixed(1)}`
}

/**
 * @param {any[]} results
 * @param {object} payload
 */
function buildReport(results, payload) {
  const lines = []
  lines.push('# Menu viewport clamp probe')
  lines.push('')
  lines.push(`Generated: ${payload.createdAt}`)
  lines.push('')
  lines.push('## Scope')
  lines.push('')
  lines.push('- Target: card **context menu** + **source picker** (`StyleCard.tsx` portals)')
  lines.push('- Anchor: last visible row, rightmost column, bottom-right of card')
  lines.push('- Scroll: 3 scroller screens before each open')
  lines.push('- Densities: `compact` / `normal` (fullscreen) / `windowed` (panel)')
  lines.push('- Thumbnail: `has_thumbnail` true/false (extra Delete preview row when true)')
  lines.push('- App code: **read-only** - this folder only')
  lines.push('')
  lines.push('## Clamp source map (read-only)')
  lines.push('')
  lines.push('| Surface | Portal | Clamp | Assumed height | File:line |')
  lines.push('|---|---|---|---|---|')
  lines.push(
    '| Context menu | yes -> `document.body` | **none** (click x/y) | - | `StyleCard.tsx:142-145,203` |',
  )
  lines.push(
    '| Source picker | yes -> `document.body` | X via assumed **width 280**; Y floor 8 | **none** (no height clamp) | `StyleCard.tsx:150-153` |',
  )
  lines.push(
    '| `ViewportFixedMenu` (not StyleCard) | yes | `fitFixedMenuPosition` + measured H | **none** (measures `rect.height`) | `ViewportFixedMenu.tsx:35-42`, pad `fitFixedMenuPosition.ts:2` (`MENU_VIEWPORT_PAD=8`) |',
  )
  lines.push('')
  lines.push('## Results')
  lines.push('')
  lines.push(
    '| density | thumb | kind | inside | inside+M8 | overflow px (L/T/R/B) | menu rect | viewport | portal | fixed offset (L,T) | transform ancestors | Delete preview | height |',
  )
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const r of results) {
    const m = r.measure
    const o = m.overflowPxVsMargin8 || m.overflowPx
    const xf =
      m.transformAncestorChain && m.transformAncestorChain.length
        ? m.transformAncestorChain
            .map((a) => `${a.tag}${a.id ? '#' + a.id : ''}(${a.transform})`)
            .join('; ')
        : '(none)'
    const off = m.fixedOffset
      ? `${Number(m.fixedOffset.styleLeft).toFixed(1)},${Number(m.fixedOffset.styleTop).toFixed(1)}`
      : '—'
    lines.push(
      `| ${r.density} | ${r.withThumb ? 'yes' : 'no'} | ${r.kind} | ${m.fullyInsideViewport ? 'YES' : 'NO'} | ${m.fullyInsideWithMenuMargin ? 'YES' : 'NO'} | ${fmtOverflow(o)} | ${fmtRect(m.menuRect)} | ${m.viewport ? `${m.viewport.width}×${m.viewport.height}` : '—'} | ${m.portaledToBody ? 'body' : '—'} | ${off} | ${xf} | ${m.hasDeletePreview ?? '—'} | ${m.menuRect ? m.menuRect.height.toFixed(0) : '—'} |`,
    )
  }
  lines.push('')
  lines.push('## Findings')
  lines.push('')
  const ctx = results.filter((r) => r.kind === 'contextMenu')
  const pick = results.filter((r) => r.kind === 'sourcePicker')
  const ctxBot = ctx.map((r) => r.measure?.overflowPxVsMargin8?.bottom ?? 0)
  const pickBot = pick.map((r) => r.measure?.overflowPxVsMargin8?.bottom ?? 0)
  const ctxH = ctx.map((r) => r.measure?.menuRect?.height).filter(Boolean)
  const thumbOn = ctx.filter((r) => r.withThumb)
  const thumbOff = ctx.filter((r) => !r.withThumb)
  const hOn = thumbOn.map((r) => r.measure?.menuRect?.height).filter(Boolean)
  const hOff = thumbOff.map((r) => r.measure?.menuRect?.height).filter(Boolean)
  lines.push(
    `1. **Context menu** portals to \`document.body\`, \`position:fixed\` at raw click coords (\`StyleCard.tsx:142-145\`). No clamp → bottom overflow **${Math.min(...ctxBot).toFixed(0)}-${Math.max(...ctxBot).toFixed(0)}px** at bottom-right after scroll x3. Thumb on → Delete preview (heights ${hOff[0] ?? '?'} → ${hOn[0] ?? '?'}).`,
  )
  lines.push(
    `2. **Source picker** portals to \`document.body\`, X clamped with **assumed width 280** (\`StyleCard.tsx:151\`), Y only \`max(8, card.top)\` — **no height clamp**. Bottom overflow **${Math.min(...pickBot).toFixed(0)}-${Math.max(...pickBot).toFixed(0)}px** (fails \`MENU_MARGIN\`).`,
  )
  lines.push(
    '3. **Assumed height:** none for either StyleCard surface (`clampAssumedHeight: null`). Shared helper `fitFixedMenuPosition` measures live `rect.height` — used only by `ViewportFixedMenu`, not StyleCard.',
  )
  lines.push(
    '4. **Transformed ancestors:** empty chain for all cases (portal escapes grid `translateY`).',
  )
  lines.push(
    '5. **Fixed offset:** Δ(0,0) vs style left/top — portal is not offset by row transforms.',
  )
  lines.push('')
  lines.push(
    'Full per-case JSON (menuRect, viewport, overflow, portal, fixedOffset, transformAncestorChain): `out/menu-probe.raw.json`.',
  )
  lines.push('')
  lines.push('## Assertion outline - menu fully inside viewport with `MENU_MARGIN`')
  lines.push('')
  lines.push(
    'Target constant (today in app): `MENU_VIEWPORT_PAD = 8` at `fitFixedMenuPosition.ts:2`.',
  )
  lines.push(
    'Bench alias for the contract: **`MENU_MARGIN = 8`** (same value) — `ui/bench/menu/assertInsideViewport.mjs`.',
  )
  lines.push('')
  lines.push('```ts')
  lines.push('const MENU_MARGIN = 8 // === MENU_VIEWPORT_PAD')
  lines.push('')
  lines.push('function assertMenuFullyInsideViewport(menu: DOMRect, vw: number, vh: number) {')
  lines.push('  expect(menu.left).toBeGreaterThanOrEqual(MENU_MARGIN)')
  lines.push('  expect(menu.top).toBeGreaterThanOrEqual(MENU_MARGIN)')
  lines.push('  expect(menu.right).toBeLessThanOrEqual(vw - MENU_MARGIN)')
  lines.push('  expect(menu.bottom).toBeLessThanOrEqual(vh - MENU_MARGIN)')
  lines.push('')
  lines.push('  const overflow = {')
  lines.push('    left: Math.max(0, MENU_MARGIN - menu.left),')
  lines.push('    top: Math.max(0, MENU_MARGIN - menu.top),')
  lines.push('    right: Math.max(0, menu.right - (vw - MENU_MARGIN)),')
  lines.push('    bottom: Math.max(0, menu.bottom - (vh - MENU_MARGIN)),')
  lines.push('  }')
  lines.push('  expect(overflow).toEqual({ left: 0, top: 0, right: 0, bottom: 0 })')
  lines.push('}')
  lines.push('```')
  lines.push('')
  lines.push('Cases to cover in a future test (this probe is the fixture matrix):')
  lines.push('')
  lines.push('1. Context menu at bottom-right card after scroll x3 - each density x thumb on/off')
  lines.push('2. Source picker at bottom-right duplicate card after scroll x3 - same matrix')
  lines.push('3. Tall menu (thumb on -> extra Delete preview) still clears bottom by `MENU_MARGIN`')
  lines.push('4. Portal host is `document.body`; transformed-ancestor chain empty (or documented)')
  lines.push(
    '5. Fixed `left`/`top` match clamped coords (not raw click) once StyleCard adopts `fitFixedMenuPosition`',
  )
  lines.push('')
  lines.push(
    '**Current verdict from probe:** see `inside+M8` column - StyleCard menus do **not** call',
  )
  lines.push(
    '`fitFixedMenuPosition` today, so bottom-right opens are expected to fail the margin assertion',
  )
  lines.push(
    'until they share `ViewportFixedMenu` / `MENU_VIEWPORT_PAD`.',
  )
  lines.push('')
  lines.push('## Summary counters')
  lines.push('')
  const failM8 = results.filter((r) => !r.measure?.fullyInsideWithMenuMargin)
  const failEdge = results.filter((r) => !r.measure?.fullyInsideViewport)
  const found = results.filter((r) => r.measure?.found)
  lines.push(`- Cases: ${results.length}`)
  lines.push(`- Menu found: ${found.length}`)
  lines.push(`- Missing / failed open: ${results.length - found.length}`)
  lines.push(`- Overflow viewport edge: ${failEdge.length}`)
  lines.push(`- Overflow vs MENU_MARGIN(8): ${failM8.length}`)
  lines.push('')
  // Keep checkMenuInsideViewport referenced so Wave3 can import it.
  void checkMenuInsideViewport
  return lines.join('\n')
}

async function openBench(browser, baseUrl, n, withThumb) {
  const styles = makeMenuSyntheticStyles(n, withThumb)
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()
  await page.addInitScript(() => {
    window.__sgBench = { ready: false }
    window.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'SG_READY') window.__sgBench.ready = true
    })
    try {
      localStorage.removeItem('sg_v2_last_source')
    } catch {
      // ignore
    }
  })
  await stubApi(page, styles, withThumb)
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForFunction(() => Boolean(window.__sgBench?.ready), null, {
    timeout: 60_000,
  })
  await installFakeIframe(page)
  await page.evaluate((payload) => {
    window.postMessage({ type: 'SG_INIT', styles: payload }, '*')
  }, styles)
  await waitCatalog(page, n)
  await ensureAllSources(page)
  // Give loadThumbnails time to apply has_thumbnail flags from the stub list.
  await sleep(300)
  return {
    context,
    page,
    styles,
    async close() {
      await context.close()
    },
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  mkdirSync(OUT_DIR, { recursive: true })

  if (!args.skipBuild) {
    console.log('[menu] building…')
    await buildToTmp()
  } else {
    await access(path.join(TMP_DIST, 'index.html'))
    console.log('[menu] skip-build')
  }

  const server = await startStaticServer(TMP_DIST, PORT)
  const browser = await chromium.launch({
    headless: !args.headed,
    args: ['--disable-dev-shm-usage'],
  })
  /** @type {any[]} */
  const results = []

  try {
    console.log(`[menu] serving ${server.baseUrl} n=${args.n}`)
    for (const withThumb of [false, true]) {
      for (const density of DENSITIES) {
        const bench = await openBench(browser, server.baseUrl, args.n, withThumb)
        try {
          await setDensity(bench.page, density)
          await sleep(200)
          const scroll = await scrollScreens(bench.page, 3)
          await sleep(100)
          const card = await findBottomRightCard(bench.page)
          if (!card) {
            throw new Error(
              `no visible card after scroll (${density}, thumb=${withThumb})`,
            )
          }
          console.log(
            `[menu] ${density} thumb=${withThumb} card@${card.anchor.x.toFixed(0)},${card.anchor.y.toFixed(0)} visible=${card.visibleCount}`,
          )

          const ctx = await probeContextMenu(bench.page, card.anchor)
          results.push({
            density,
            withThumb,
            kind: 'contextMenu',
            card,
            scroll,
            measure: ctx,
            clampAssumedHeight: CLAMP_NOTES.contextMenu.clampAssumedHeight,
            clampAssumedHeightFileLine:
              CLAMP_NOTES.contextMenu.clampAssumedHeightFileLine,
          })
          console.log(
            `  contextMenu found=${ctx.found} inside=${ctx.fullyInsideViewport} m8=${ctx.fullyInsideWithMenuMargin} h=${ctx.menuRect?.height?.toFixed(0)} delPrev=${ctx.hasDeletePreview} overflow=${fmtOverflow(ctx.overflowPxVsMargin8)}`,
          )

          const card2 = (await findBottomRightCard(bench.page)) || card
          const pick = await probeSourcePicker(bench.page, card2.anchor)
          results.push({
            density,
            withThumb,
            kind: 'sourcePicker',
            card: card2,
            scroll,
            measure: pick,
            clampAssumedHeight: CLAMP_NOTES.sourcePicker.clampAssumedHeight,
            clampAssumedWidth: CLAMP_NOTES.sourcePicker.clampAssumedWidth,
            clampAssumedHeightFileLine:
              CLAMP_NOTES.sourcePicker.clampAssumedHeightFileLine,
            clampAssumedWidthFileLine:
              CLAMP_NOTES.sourcePicker.clampAssumedWidthFileLine,
          })
          console.log(
            `  sourcePicker found=${pick.found} inside=${pick.fullyInsideViewport} m8=${pick.fullyInsideWithMenuMargin} overflow=${fmtOverflow(pick.overflowPxVsMargin8)}`,
          )
        } finally {
          await bench.close()
        }
      }
    }

    const payload = {
      createdAt: new Date().toISOString(),
      MENU_MARGIN,
      viewport: VIEWPORT,
      n: args.n,
      densities: DENSITIES,
      clampNotes: CLAMP_NOTES,
      results,
    }
    writeFileSync(RAW_JSON, `${JSON.stringify(payload, null, 2)}\n`)
    writeFileSync(REPORT_MD, `${buildReport(results, payload)}\n`)
    console.log(`[menu] wrote ${REPORT_MD}`)
    console.log(`[menu] wrote ${RAW_JSON}`)
    const failM8 = results.filter((r) => !r.measure?.fullyInsideWithMenuMargin)
    console.log(`[menu] ${failM8.length}/${results.length} fail MENU_MARGIN`)
  } finally {
    await browser.close()
    await server.close()
  }
}

main().catch((err) => {
  console.error('[menu] FAILED', err)
  process.exit(1)
})
