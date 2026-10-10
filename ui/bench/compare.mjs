#!/usr/bin/env node
/**
 * Compare baseline / phase-a / phase-b bench JSON; print table + PERFORMANCE GATE at N=5000.
 *
 * PERFORMANCE GATE (candidate = phase-b if present else phase-a) at N=5000, 4x CPU:
 *   initMs <= 1000, toggleP50Ms <= 100, searchKeyP50Ms <= 100, scrollTbtMs <= 300
 *
 * Usage:
 *   node bench/compare.mjs
 *   node bench/compare.mjs --baseline results/baseline.json --phase-a results/phase-a.json --phase-b results/phase-b.json
 */

import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BENCH_DIR = path.dirname(fileURLToPath(import.meta.url))
const RESULTS_DIR = path.join(BENCH_DIR, 'results')

const GATE_N = 5000
const GATE = Object.freeze({
  initMs: 1000,
  toggleP50Ms: 100,
  searchKeyP50Ms: 100,
  scrollTbtMs: 300,
})

const METRICS = Object.freeze([
  'initMs',
  'toggleP50Ms',
  'searchKeyP50Ms',
  'scrollTbtMs',
  'longTasks',
])

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {{ baseline: string, phaseA: string, phaseB: string }} */
  const out = {
    baseline: path.join(RESULTS_DIR, 'baseline.json'),
    phaseA: path.join(RESULTS_DIR, 'phase-a.json'),
    phaseB: path.join(RESULTS_DIR, 'phase-b.json'),
  }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--baseline') out.baseline = path.resolve(argv[++i])
    else if (a === '--phase-a' || a === '--phase') out.phaseA = path.resolve(argv[++i])
    else if (a === '--phase-b') out.phaseB = path.resolve(argv[++i])
  }
  return out
}

/** Resolve CLI paths from cwd, bench/, or bench/results/. */
async function resolveResultPath(filePath) {
  const candidates = [
    path.resolve(filePath),
    path.resolve(BENCH_DIR, filePath),
    path.resolve(RESULTS_DIR, path.basename(filePath)),
  ]
  for (const candidate of candidates) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // try next
    }
  }
  throw new Error(`result file not found: ${filePath} (tried: ${candidates.join(' | ')})`)
}

/** @param {string} filePath */
async function loadResult(filePath) {
  const resolved = await resolveResultPath(filePath)
  const raw = await readFile(resolved, 'utf8')
  return { path: resolved, doc: JSON.parse(raw) }
}

/** @param {string} filePath */
async function tryLoadResult(filePath) {
  try {
    return await loadResult(filePath)
  } catch {
    return null
  }
}

/** @param {number[]} values */
function medianOf(values) {
  const sorted = [...values].filter((v) => typeof v === 'number' && !Number.isNaN(v)).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

/**
 * Prefer sizes[n].median[key], then top-level sizes[n][key], then median of runs.
 * @param {Record<string, unknown> | null} doc
 * @param {number} n
 * @param {string} key
 */
function metricAt(doc, n, key) {
  const block = /** @type {Record<string, unknown> | undefined} */ (doc?.sizes?.[String(n)])
  if (!block) return null
  const median = /** @type {Record<string, unknown> | undefined} */ (block.median)
  if (median && typeof median[key] === 'number') return /** @type {number} */ (median[key])
  if (typeof block[key] === 'number') return /** @type {number} */ (block[key])
  if (Array.isArray(block.runs)) {
    return medianOf(
      /** @type {Array<Record<string, number>>} */ (block.runs).map((r) => r[key]),
    )
  }
  return null
}

/** @param {number | null} v */
function fmt(v) {
  if (v == null || Number.isNaN(v)) return '—'
  return typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(1) : String(v)
}

/** @param {Record<string, unknown>} doc */
function evaluateGate(doc) {
  /** @type {Array<{ key: string, value: number | null, limit: number, pass: boolean | null }>} */
  const results = []
  for (const [key, limit] of Object.entries(GATE)) {
    const v = metricAt(doc, GATE_N, key)
    const pass = v != null && v <= limit
    results.push({
      key,
      value: v,
      limit,
      pass: v == null ? null : pass,
    })
  }
  const known = results.filter((r) => r.pass != null)
  const allPass = known.length > 0 && known.every((r) => r.pass)
  return { n: GATE_N, results, allPass }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const baselineLoaded = await loadResult(args.baseline)
  const phaseALoaded = await tryLoadResult(args.phaseA)
  const phaseBLoaded = await tryLoadResult(args.phaseB)

  const baseline = baselineLoaded.doc
  const phaseA = phaseALoaded?.doc ?? null
  const phaseB = phaseBLoaded?.doc ?? null

  const sizes = [500, 2000, 5000]
  /** @type {Array<{ n: number, key: string, baseline: number | null, phaseA: number | null, phaseB: number | null }>} */
  const rows = []

  for (const n of sizes) {
    for (const key of METRICS) {
      rows.push({
        n,
        key,
        baseline: metricAt(baseline, n, key),
        phaseA: phaseA ? metricAt(phaseA, n, key) : null,
        phaseB: phaseB ? metricAt(phaseB, n, key) : null,
      })
    }
  }

  console.log('')
  console.log('Style Grid bench compare (3-way)')
  console.log(`baseline: ${baselineLoaded.path}`)
  console.log(`phase-a:  ${phaseALoaded ? phaseALoaded.path : '(missing)'}`)
  console.log(`phase-b:  ${phaseBLoaded ? phaseBLoaded.path : '(missing)'}`)
  console.log('')
  console.log(
    [
      'N'.padStart(6),
      'metric'.padEnd(16),
      'baseline'.padStart(10),
      'phase-a'.padStart(10),
      'phase-b'.padStart(10),
      'Δa-base'.padStart(10),
      'Δb-a'.padStart(10),
    ].join('  '),
  )
  console.log('-'.repeat(88))
  for (const row of rows) {
    const dAB = row.baseline != null && row.phaseA != null ? row.phaseA - row.baseline : null
    const dBA = row.phaseA != null && row.phaseB != null ? row.phaseB - row.phaseA : null
    console.log(
      [
        String(row.n).padStart(6),
        row.key.padEnd(16),
        fmt(row.baseline).padStart(10),
        fmt(row.phaseA).padStart(10),
        fmt(row.phaseB).padStart(10),
        fmt(dAB).padStart(10),
        fmt(dBA).padStart(10),
      ].join('  '),
    )
  }

  const gateTarget = phaseB ?? phaseA ?? baseline
  const gateLabel = phaseB ? 'phase-b' : phaseA ? 'phase-a' : 'baseline'
  const gate = evaluateGate(gateTarget)
  console.log('')
  console.log(`PERFORMANCE GATE (N=${GATE_N}, 4x CPU, ${gateLabel}): ${gate.allPass ? 'PASS' : 'FAIL'}`)
  for (const r of gate.results) {
    const status = r.pass == null ? 'MISSING' : r.pass ? 'PASS' : 'FAIL'
    console.log(`  ${r.key}: ${fmt(r.value)} (limit <=${r.limit}) → ${status}`)
  }
  console.log('')

  if (!gate.allPass) {
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
