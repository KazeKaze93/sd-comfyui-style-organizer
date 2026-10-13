#!/usr/bin/env node
/**
 * Style Grid PHASE A bench harness (ComfyUI).
 *
 * - Playwright Chromium
 * - CDP CPU throttle 4x
 * - N ∈ {500, 2000, 5000}, 3 runs → median
 * - SG_INIT synthetic styles; stubs /style_grid/**
 * - Builds to ui/bench/.tmp/dist (never writes web/ui)
 *
 * Usage:
 *   node bench/run.mjs --label baseline
 *   node bench/run.mjs --label phase-a --sizes 500,2000,5000 --runs 3
 *   node bench/run.mjs --label smoke --sizes 500 --runs 1 --skip-build
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, writeFile, readFile, access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { median, runScenario } from './lib/measure.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UI_ROOT = path.resolve(__dirname, '..')
const BENCH_ROOT = __dirname
const TMP_DIST = path.join(BENCH_ROOT, '.tmp', 'dist')
const RESULTS_DIR = path.join(BENCH_ROOT, 'results')

const DEFAULT_SIZES = [500, 2000, 5000]
const DEFAULT_RUNS = 3
const CPU_THROTTLE = 4
const PREVIEW_PORT = 4179

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {{ label: string, sizes: number[], runs: number, skipBuild: boolean, out: string | null, baseUrl: string | null }} */
  const out = {
    label: 'run',
    sizes: DEFAULT_SIZES,
    runs: DEFAULT_RUNS,
    skipBuild: false,
    out: null,
    baseUrl: null,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--label') out.label = argv[++i]
    else if (a === '--sizes') {
      out.sizes = argv[++i].split(',').map((s) => Number(s.trim())).filter((n) => n > 0)
    } else if (a === '--runs') out.runs = Number(argv[++i])
    else if (a === '--skip-build') out.skipBuild = true
    else if (a === '--out') out.out = argv[++i]
    else if (a === '--base-url') out.baseUrl = argv[++i]
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: node bench/run.mjs --label <name> [--sizes 500,2000,5000] [--runs 3] [--out path] [--skip-build]`)
      process.exit(0)
    }
  }
  if (!out.label) throw new Error('--label is required')
  if (!out.sizes.length) throw new Error('--sizes empty')
  if (!Number.isInteger(out.runs) || out.runs < 1) throw new Error('--runs must be >= 1')
  return out
}

/** @param {string} command @param {string[]} args @param {{ cwd: string, env?: NodeJS.ProcessEnv }} opts */
function runCmd(command, args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
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
  // Explicit outDir keeps ../web/ui untouched (vite.config default).
  const viteJs = path.join(UI_ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
  await runCmd(
    process.execPath,
    [viteJs, 'build', '--outDir', path.relative(UI_ROOT, TMP_DIST), '--emptyOutDir'],
    { cwd: UI_ROOT },
  )
  await access(path.join(TMP_DIST, 'index.html'))
}

/**
 * Minimal static server for TMP_DIST (avoids vite preview writing/locking).
 * @param {string} root
 * @param {number} port
 */
async function startStaticServer(root, port) {
  const { createReadStream } = await import('node:fs')
  const { stat } = await import('node:fs/promises')

  /** @param {string} p */
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

/**
 * @param {Array<Record<string, number>>} runs
 * @param {string} key
 */
function medianField(runs, key) {
  return median(runs.map((r) => r[key]))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  await mkdir(RESULTS_DIR, { recursive: true })

  let server = null
  let baseUrl = args.baseUrl
  if (!baseUrl) {
    if (!args.skipBuild) {
      console.log('[bench] building →', TMP_DIST)
      await buildToTmp()
    } else {
      await access(path.join(TMP_DIST, 'index.html'))
    }
    server = await startStaticServer(TMP_DIST, PREVIEW_PORT)
    baseUrl = server.baseUrl
    console.log('[bench] serving', baseUrl)
  }

  const commit = await gitMeta(path.resolve(UI_ROOT, '..'))
  const browser = await chromium.launch({ headless: true })

  /** @type {Record<string, unknown>} */
  const sizesOut = {}

  try {
    for (const n of args.sizes) {
      console.log(`\n[bench] N=${n}  runs=${args.runs}  cpu=${CPU_THROTTLE}x`)
      /** @type {Array<Record<string, number>>} */
      const runs = []
      for (let i = 0; i < args.runs; i += 1) {
        process.stdout.write(`  run ${i + 1}/${args.runs}... `)
        const result = await runScenario(browser, {
          baseUrl,
          n,
          cpuThrottle: CPU_THROTTLE,
        })
        runs.push({
          initMs: result.initMs,
          toggleP50Ms: result.toggleP50Ms,
          searchKeyP50Ms: result.searchKeyP50Ms,
          scrollTbtMs: result.scrollTbtMs,
          longTasks: result.longTasks,
          layoutOk: result.layoutOk !== false,
        })
        console.log(
          `init=${result.initMs.toFixed(1)} toggleP50=${result.toggleP50Ms.toFixed(1)} ` +
            `searchP50=${result.searchKeyP50Ms.toFixed(1)} scrollTbt=${result.scrollTbtMs.toFixed(1)} ` +
            `longTasks=${result.longTasks}` +
            (result.layoutOk === false ? ' layout=FAIL' : ''),
        )
        if (result.layoutOk === false) {
          throw new Error(`layout invariants failed for N=${n}`)
        }
      }

      sizesOut[String(n)] = {
        runs,
        median: {
          initMs: medianField(runs, 'initMs'),
          toggleP50Ms: medianField(runs, 'toggleP50Ms'),
          searchKeyP50Ms: medianField(runs, 'searchKeyP50Ms'),
          scrollTbtMs: medianField(runs, 'scrollTbtMs'),
          longTasks: medianField(runs, 'longTasks'),
        },
      }
    }
  } finally {
    await browser.close()
    if (server) await server.close()
  }

  const payload = {
    label: args.label,
    host: 'comfy',
    phase: args.label.startsWith('phase-b') ? 'B' : 'A',
    commit,
    timestamp: new Date().toISOString(),
    cpuThrottle: CPU_THROTTLE,
    runsPerSize: args.runs,
    browser: 'chromium',
    sizes: sizesOut,
  }

  const outPath = args.out
    ? path.resolve(args.out)
    : path.join(RESULTS_DIR, `${args.label}.json`)
  await mkdir(path.dirname(outPath), { recursive: true })
  await writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  console.log(`\n[bench] wrote ${outPath}`)

  // Print median table
  console.log('\n=== Median table ===')
  console.log(
    'N'.padStart(6),
    'initMs'.padStart(10),
    'toggleP50'.padStart(10),
    'searchP50'.padStart(10),
    'scrollTbt'.padStart(10),
    'longTasks'.padStart(10),
  )
  for (const n of args.sizes) {
    const m = /** @type {{ median: Record<string, number> }} */ (sizesOut[String(n)]).median
    console.log(
      String(n).padStart(6),
      m.initMs.toFixed(1).padStart(10),
      m.toggleP50Ms.toFixed(1).padStart(10),
      m.searchKeyP50Ms.toFixed(1).padStart(10),
      m.scrollTbtMs.toFixed(1).padStart(10),
      m.longTasks.toFixed(1).padStart(10),
    )
  }
}

main().catch((err) => {
  console.error('[bench] FAILED', err)
  process.exit(1)
})
