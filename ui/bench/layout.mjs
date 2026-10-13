#!/usr/bin/env node
/**
 * Layout invariant bench (ComfyUI).
 *
 * Densities × positions at N=500 (fast) or N=500,5000 (full).
 * Fails closed on height / gap parity / overlap. Prints ≤10 offenders.
 *
 * Usage (from ui/):
 *   npm run bench:layout
 *   node bench/layout.mjs --sizes 500,5000
 *   node bench/layout.mjs --glue-fixture          # must FAIL (prove harness)
 *   node bench/layout.mjs --skip-build
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import {
  BENCH_ROOT,
  TMP_DIST,
  buildToTmp,
  openBenchPage,
  scrollThreeScreens,
  setDensity,
  startStaticServer,
} from './lib/benchHost.mjs'
import { LAYOUT_DENSITIES } from './lib/gridMetrics.mjs'
import {
  checkLayoutInvariants,
  injectGlueFixture,
  printLayoutFailure,
} from './lib/layoutInvariants.mjs'

const PREVIEW_PORT = 4187
const OUT_DIR = path.join(BENCH_ROOT, '.tmp', 'layout')

function parseArgs(argv) {
  /** @type {{ sizes: number[], skipBuild: boolean, glueFixture: boolean, densities: string[], positions: string[] }} */
  const out = {
    sizes: [500],
    skipBuild: false,
    glueFixture: false,
    densities: [...LAYOUT_DENSITIES],
    positions: ['top', 'scrolled'],
  }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--sizes') {
      out.sizes = argv[++i]
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => n > 0)
    } else if (a === '--skip-build') out.skipBuild = true
    else if (a === '--glue-fixture') out.glueFixture = true
    else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: node bench/layout.mjs [--sizes 500] [--glue-fixture] [--skip-build]',
      )
      process.exit(0)
    }
  }
  if (!out.sizes.length) throw new Error('--sizes empty')
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  await mkdir(OUT_DIR, { recursive: true })

  if (!args.skipBuild) {
    console.log('[layout] building →', TMP_DIST)
    await buildToTmp()
  }

  const server = await startStaticServer(TMP_DIST, PREVIEW_PORT)
  const browser = await chromium.launch({ headless: true })
  /** @type {import('./lib/layoutInvariants.mjs').LayoutCheckResult[]} */
  const results = []
  let failed = 0

  try {
    for (const n of args.sizes) {
      for (const density of args.densities) {
        for (const position of args.positions) {
          const label = `N=${n} ${density} ${position}`
          process.stdout.write(`[layout] ${label}... `)
          const { context, page } = await openBenchPage(browser, {
            baseUrl: server.baseUrl,
            n,
            // Avoid source-picker overlays from multi-source name dups.
            seedSelected: false,
          })
          try {
            await setDensity(page, density)
            await page.waitForTimeout(150)
            if (position === 'scrolled') await scrollThreeScreens(page)
            if (args.glueFixture) {
              await injectGlueFixture(page)
              await page.waitForTimeout(50)
            }

            const check = await checkLayoutInvariants(page, {
              density: /** @type {'windowed'|'compact-windowed'|'normal'|'compact'} */ (
                density
              ),
              position: /** @type {'top'|'scrolled'} */ (position),
              n,
            })
            results.push(check)
            if (check.ok) {
              console.log(
                `OK cards=${check.measured.cardCount} hGap=${check.measured.hGapPx} ` +
                  `vGap≈${check.measured.vGaps[0]?.toFixed?.(1) ?? 'n/a'}`,
              )
            } else {
              failed += 1
              console.log('FAIL')
              printLayoutFailure(check)
            }
          } finally {
            await context.close()
          }
        }
      }
    }
  } finally {
    await browser.close()
    await server.close()
  }

  const reportPath = path.join(
    OUT_DIR,
    args.glueFixture ? 'report-glue-fixture.json' : 'report.json',
  )
  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        glueFixture: args.glueFixture,
        failed,
        total: results.length,
        results,
        timestamp: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  console.log(`[layout] wrote ${reportPath}`)

  if (args.glueFixture) {
    if (failed === 0) {
      console.error(
        '[layout] FAIL PROOF BROKEN: --glue-fixture expected failures but all passed',
      )
      process.exit(2)
    }
    console.log(
      `[layout] FAIL proof OK: ${failed}/${results.length} cases failed with glue fixture`,
    )
    process.exit(0)
  }

  if (failed > 0) {
    console.error(`[layout] ${failed}/${results.length} cases failed`)
    process.exit(1)
  }
  console.log(`[layout] all ${results.length} cases passed`)
}

main().catch((err) => {
  console.error('[layout] FAILED', err)
  process.exit(1)
})
