#!/usr/bin/env node
/**
 * Compare two bench result JSON files and evaluate PHASE B GATE at N=5000.
 *
 * SHARED SPEC — absolute gate on candidate medians at N=5000 after phase A:
 *   initMs > 1000 OR toggleP50Ms > 100 OR searchKeyP50Ms > 100 OR scrollTbtMs > 300
 *   → verdict "VIRTUALIZATION NEEDED"
 *   else → "NOT NEEDED"
 *
 * Relative Δ% vs baseline is printed for information only; it does not decide the gate.
 *
 * Usage:
 *   node bench/compare.mjs results/baseline.json results/phase-a.json
 */

import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BENCH_DIR = path.dirname(fileURLToPath(import.meta.url))
const RESULTS_DIR = path.join(BENCH_DIR, 'results')
const GATE_N = 5000

/** Absolute Phase B gate thresholds (candidate median at GATE_N). */
const GATE_INIT_MS = 1000
const GATE_TOGGLE_P50_MS = 100
const GATE_SEARCH_KEY_P50_MS = 100
const GATE_SCROLL_TBT_MS = 300

const VERDICT_NEEDED = 'VIRTUALIZATION NEEDED'
const VERDICT_NOT_NEEDED = 'NOT NEEDED'

/** @type {ReadonlyArray<{ metric: string, limit: number, label: string }>} */
const ABSOLUTE_GATE_RULES = [
  { metric: 'initMs', limit: GATE_INIT_MS, label: `initMs > ${GATE_INIT_MS}` },
  { metric: 'toggleP50Ms', limit: GATE_TOGGLE_P50_MS, label: `toggleP50Ms > ${GATE_TOGGLE_P50_MS}` },
  { metric: 'searchKeyP50Ms', limit: GATE_SEARCH_KEY_P50_MS, label: `searchKeyP50Ms > ${GATE_SEARCH_KEY_P50_MS}` },
  { metric: 'scrollTbtMs', limit: GATE_SCROLL_TBT_MS, label: `scrollTbtMs > ${GATE_SCROLL_TBT_MS}` },
]

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
  return JSON.parse(raw)
}

/**
 * @param {number} baseline
 * @param {number} candidate
 */
function deltaPct(baseline, candidate) {
  if (baseline === 0) return candidate === 0 ? 0 : Infinity
  return ((candidate - baseline) / baseline) * 100
}

async function main() {
  const [, , basePath, candPath] = process.argv
  if (!basePath || !candPath) {
    console.error('Usage: node bench/compare.mjs <baseline.json> <candidate.json>')
    process.exit(2)
  }

  const baseline = await loadResult(path.resolve(basePath))
  const candidate = await loadResult(path.resolve(candPath))

  const sizes = Object.keys(baseline.sizes || {}).sort((a, b) => Number(a) - Number(b))
  console.log(`Baseline:  ${baseline.label}  commit=${baseline.commit ?? '?'}`)
  console.log(`Candidate: ${candidate.label}  commit=${candidate.commit ?? '?'}`)
  console.log('')

  const metrics = ['initMs', 'toggleP50Ms', 'searchKeyP50Ms', 'scrollTbtMs', 'longTasks']

  for (const n of sizes) {
    const b = baseline.sizes?.[n]?.median
    const c = candidate.sizes?.[n]?.median
    if (!b || !c) {
      console.log(`N=${n}: missing median on one side — skip`)
      continue
    }
    console.log(`=== N=${n} (median, informational Δ%) ===`)
    console.log(
      'metric'.padEnd(16),
      'baseline'.padStart(10),
      'candidate'.padStart(10),
      'Δ%'.padStart(10),
    )
    for (const m of metrics) {
      const bv = Number(b[m])
      const cv = Number(c[m])
      const d = deltaPct(bv, cv)
      const sign = d > 0 ? '+' : ''
      console.log(
        m.padEnd(16),
        bv.toFixed(1).padStart(10),
        cv.toFixed(1).padStart(10),
        `${sign}${d.toFixed(1)}%`.padStart(10),
      )
    }
    console.log('')
  }

  const c5 = candidate.sizes?.[String(GATE_N)]?.median
  console.log(`=== PHASE B GATE (N=${GATE_N}, absolute) ===`)
  if (!c5) {
    console.log('FAIL — missing N=5000 candidate medians')
    process.exit(1)
  }

  let needsVirtualization = false
  for (const rule of ABSOLUTE_GATE_RULES) {
    const cv = Number(c5[rule.metric])
    const exceeds = cv > rule.limit
    if (exceeds) needsVirtualization = true
    console.log(
      `${exceeds ? 'EXCEEDS' : 'OK'}  ${rule.metric.padEnd(16)}  ` +
        `cand=${cv.toFixed(1)}  threshold>${rule.limit}  — ${rule.label}`,
    )
  }

  const verdict = needsVirtualization ? VERDICT_NEEDED : VERDICT_NOT_NEEDED
  console.log('')
  console.log(`PHASE B GATE: ${verdict}`)
  process.exit(needsVirtualization ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
