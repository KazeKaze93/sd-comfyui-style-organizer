#!/usr/bin/env node
/**
 * KEYS-E2E prod bench (ComfyUI Style Organizer).
 *
 * Playwright + vite build → ui/bench/.tmp/dist (never writes web/ui).
 * Asserts keyboard contract at N ∈ {500, 5000}. Incomplete UI → FAIL.
 *
 * Usage (from ui/):
 *   npm run bench:keys
 *   node bench/keys/run.mjs --sizes 500,5000
 *   node bench/keys/run.mjs --skip-build
 *   node bench/keys/run.mjs --sizes 500 --headed
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import {
  TMP_DIST,
  buildToTmp,
  openBenchPage,
  scrollThreeScreens,
  setDensity,
  startStaticServer,
} from '../lib/benchHost.mjs'
import { installPageErrorProbe, runKeyAssertions } from './assertions.mjs'
import { installSafeFakeIframe } from './fakeIframe.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.join(__dirname, 'out')
const REPORT_MD = path.join(__dirname, 'report.md')
const RAW_JSON = path.join(OUT_DIR, 'keys-e2e.json')
const PREVIEW_PORT = 4193
const DEFAULT_SIZES = [500, 5000]

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ sizes: number[], skipBuild: boolean, headed: boolean }} */
  const out = {
    sizes: [...DEFAULT_SIZES],
    skipBuild: false,
    headed: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--sizes') {
      out.sizes = argv[++i]
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => n > 0)
    } else if (a === '--skip-build') out.skipBuild = true
    else if (a === '--headed') out.headed = true
    else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: node bench/keys/run.mjs [--sizes 500,5000] [--skip-build] [--headed]',
      )
      process.exit(0)
    }
  }
  if (!out.sizes.length) throw new Error('--sizes empty')
  return out
}

/**
 * @param {{ n: number, results: import('./assertions.mjs').AssertionResult[] }[]} suites
 */
function formatReport(suites) {
  const generated = new Date().toISOString()
  const lines = [
    '# KEYS-E2E report (ComfyUI)',
    '',
    `Generated: ${generated}`,
    '',
    '## Scope',
    '',
    '- Prod build → `ui/bench/.tmp/dist` (read-only `ui/src`, `web/ui`)',
    '- Playwright Chromium · stub `/style_grid/**` · `SG_INIT` synthetic catalog',
    '- Fake iframe: `frameElement` is a sibling marker (not an ancestor of `#root`)',
    '- Sizes: N=500 and N=5000 (default)',
    '- Contract: Tab into/out · arrows · Enter/Space · Home/End/Ctrl/PageDown ·',
    '  focus survives scroll×3 · ContextMenu/Shift+F10 + Escape restore ·',
    '  Escape layering · dialog trap+restore · no body focus',
    '',
    '## Results',
    '',
  ]

  let failTotal = 0
  let passTotal = 0
  for (const suite of suites) {
    lines.push(`### N=${suite.n}`, '')
    lines.push('| id | result | detail |', '|---|---|---|')
    for (const r of suite.results) {
      if (r.ok) passTotal += 1
      else failTotal += 1
      const detail = r.detail.replace(/\|/g, '\\|')
      lines.push(`| \`${r.id}\` | ${r.ok ? 'PASS' : 'FAIL'} | ${detail} |`)
    }
    lines.push('')
  }

  lines.push(
    '## Summary',
    '',
    `- PASS: ${passTotal}`,
    `- FAIL: ${failTotal}`,
    `- Verdict: ${failTotal === 0 ? 'PASS' : 'FAIL'}`,
    '',
  )
  return lines.join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  await mkdir(OUT_DIR, { recursive: true })

  if (!args.skipBuild) {
    console.log('[keys] building →', TMP_DIST)
    await buildToTmp()
  } else {
    console.log('[keys] skip-build; using', TMP_DIST)
  }

  const server = await startStaticServer(TMP_DIST, PREVIEW_PORT)
  const browser = await chromium.launch({ headless: !args.headed })
  /** @type {{ n: number, results: import('./assertions.mjs').AssertionResult[] }[]} */
  const suites = []
  let failed = 0

  try {
    for (const n of args.sizes) {
      console.log(`[keys] N=${n} opening…`)
      const { context, page } = await openBenchPage(browser, {
        baseUrl: server.baseUrl,
        n,
        seedSelected: false,
      })
      // Repair shared benchHost fake iframe: frameElement must NOT ancestor #root.
      await installSafeFakeIframe(page)
      const errorProbe = installPageErrorProbe(page)
      /** @type {{ context: import('playwright').BrowserContext, page: import('playwright').Page }} */
      let session = { context, page }
      const reopen = async () => {
        await session.context.close().catch(() => {})
        const next = await openBenchPage(browser, {
          baseUrl: server.baseUrl,
          n,
          seedSelected: false,
        })
        await installSafeFakeIframe(next.page)
        errorProbe.attach(next.page)
        await setDensity(next.page, 'normal')
        await next.page.waitForTimeout(150)
        session = { context: next.context, page: next.page }
        return next.page
      }

      try {
        await setDensity(page, 'normal')
        await page.waitForTimeout(150)
        console.log(`[keys] N=${n} running assertions…`)
        const results = await runKeyAssertions(session.page, {
          scrollThreeScreens,
          getErrors: errorProbe.getErrors,
          reopen,
          getPage: () => session.page,
        })
        suites.push({ n, results })

        for (const r of results) {
          const mark = r.ok ? 'PASS' : 'FAIL'
          if (!r.ok) failed += 1
          console.log(`  [${mark}] ${r.id} — ${r.detail}`)
        }
      } finally {
        await session.context.close().catch(() => {})
      }
    }
  } finally {
    await browser.close()
    await server.close()
  }

  const report = formatReport(suites)
  await writeFile(REPORT_MD, report, 'utf8')
  await writeFile(
    RAW_JSON,
    JSON.stringify({ generated: new Date().toISOString(), suites }, null, 2),
    'utf8',
  )

  console.log('')
  console.log(`[keys] report → ${REPORT_MD}`)
  console.log(`[keys] raw → ${RAW_JSON}`)
  console.log(`[keys] verdict: ${failed === 0 ? 'PASS' : `FAIL (${failed})`}`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('[keys] fatal:', err)
  process.exit(2)
})
