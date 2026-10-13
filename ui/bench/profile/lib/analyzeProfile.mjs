/**
 * Aggregate CDP CPU profile self-time and map call frames → original file:line.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { SourceMapConsumer } from 'source-map'

/**
 * @param {string} distRoot
 * @param {string | undefined} scriptUrl
 */
async function resolveSourceMap(distRoot, scriptUrl) {
  if (!scriptUrl) return null
  let pathname
  try {
    pathname = new URL(scriptUrl).pathname
  } catch {
    pathname = scriptUrl
  }
  const base = path.basename(pathname)
  if (!base.endsWith('.js')) return null
  const mapPath = path.join(distRoot, 'assets', `${base}.map`)
  try {
    const raw = JSON.parse(await readFile(mapPath, 'utf8'))
    return { consumer: new SourceMapConsumer(raw), generatedFile: base }
  } catch {
    return null
  }
}

/**
 * @param {string} url
 */
function shortUrl(url) {
  if (!url) return '(unknown)'
  try {
    const u = new URL(url)
    return u.pathname.split('/').slice(-2).join('/')
  } catch {
    return url.replace(/^.*\//, '')
  }
}

/**
 * @param {string} source
 */
function normalizeSrcPath(source) {
  if (!source) return '(unknown)'
  const cleaned = source
    .replace(/\\/g, '/')
    .replace(/^webpack:\/\//, '')
    .replace(/^\/?(\.\.\/)+/, '')
  const idx = cleaned.lastIndexOf('ui/src/')
  if (idx >= 0) return cleaned.slice(idx + 'ui/'.length)
  const srcIdx = cleaned.lastIndexOf('/src/')
  if (srcIdx >= 0) return cleaned.slice(srcIdx + 1)
  if (cleaned.startsWith('src/')) return cleaned
  return cleaned.replace(/^.*node_modules\//, 'node_modules/')
}

/**
 * @typedef {{
 *   functionName: string
 *   url: string
 *   lineNumber: number
 *   columnNumber: number
 *   selfUs: number
 *   hitCount: number
 *   fileLine: string
 *   mapped: boolean
 * }} FrameAgg
 */

/**
 * @param {object} profile CDP Profiler.Profile
 * @param {string} distRoot
 * @param {{ topN?: number }} [opts]
 */
export async function analyzeCpuProfile(profile, distRoot, opts = {}) {
  const topN = opts.topN ?? 15
  const nodes = profile.nodes || []
  const samples = profile.samples || []
  const timeDeltas = profile.timeDeltas || []

  /** self microseconds per node id */
  const selfUs = new Map()
  let totalSampleUs = 0
  for (let i = 0; i < samples.length; i += 1) {
    const id = samples[i]
    const dt = timeDeltas[i] ?? 0
    totalSampleUs += dt
    selfUs.set(id, (selfUs.get(id) || 0) + dt)
  }

  /** @type {Map<string, { consumer: import('source-map').SourceMapConsumer, generatedFile: string } | null>} */
  const mapCache = new Map()

  /**
   * @param {string | undefined} url
   */
  async function getMap(url) {
    const key = url || ''
    if (mapCache.has(key)) return mapCache.get(key)
    const resolved = await resolveSourceMap(distRoot, url)
    mapCache.set(key, resolved)
    return resolved
  }

  /** @type {Map<string, FrameAgg>} */
  const agg = new Map()

  for (const node of nodes) {
    const us = selfUs.get(node.id) || 0
    if (us <= 0) continue
    const cf = node.callFrame || {}
    const functionName = cf.functionName || '(anonymous)'
    const url = cf.url || ''
    // CDP line/column are 0-based
    const lineNumber = typeof cf.lineNumber === 'number' ? cf.lineNumber : -1
    const columnNumber = typeof cf.columnNumber === 'number' ? cf.columnNumber : -1

    let fileLine = `${shortUrl(url)}:${lineNumber + 1}`
    let mapped = false
    // Prefer V8's callFrame.functionName; sourcemap pos.name is often the
    // nearest enclosing binding and mislabels nested samples.
    let mapKeyName = functionName

    const sm = await getMap(url)
    if (sm && lineNumber >= 0) {
      const pos = sm.consumer.originalPositionFor({
        line: lineNumber + 1,
        column: Math.max(0, columnNumber),
      })
      if (pos && pos.source) {
        const src = normalizeSrcPath(pos.source)
        const line = pos.line || 0
        fileLine = `${src}:${line}`
        mapped = true
        if ((!mapKeyName || mapKeyName === '(anonymous)') && pos.name) {
          mapKeyName = pos.name
        }
      }
    }

    const key = `${mapKeyName}\0${fileLine}`
    const prev = agg.get(key)
    if (prev) {
      prev.selfUs += us
      prev.hitCount += node.hitCount || 0
    } else {
      agg.set(key, {
        functionName: mapKeyName,
        url,
        lineNumber,
        columnNumber,
        selfUs: us,
        hitCount: node.hitCount || 0,
        fileLine,
        mapped,
      })
    }
  }

  const ranked = [...agg.values()].sort((a, b) => b.selfUs - a.selfUs)
  const top = ranked.slice(0, topN).map((r, i) => ({
    rank: i + 1,
    functionName: r.functionName,
    fileLine: r.fileLine,
    selfMs: r.selfUs / 1000,
    selfPct: totalSampleUs > 0 ? (100 * r.selfUs) / totalSampleUs : 0,
    mapped: r.mapped,
  }))

  return {
    totalSampleMs: totalSampleUs / 1000,
    sampleCount: samples.length,
    top,
    all: ranked.map((r) => ({
      functionName: r.functionName,
      fileLine: r.fileLine,
      selfMs: r.selfUs / 1000,
      selfPct: totalSampleUs > 0 ? (100 * r.selfUs) / totalSampleUs : 0,
      mapped: r.mapped,
    })),
  }
}

/**
 * Sum selfMs for frames matching any of the predicates (function name or file path).
 * @param {Array<{ functionName: string, fileLine: string, selfMs: number }>} frames
 * @param {RegExp[]} patterns
 */
export function sumMatchingSelfMs(frames, patterns) {
  let sum = 0
  for (const f of frames) {
    const hay = `${f.functionName} ${f.fileLine}`
    if (patterns.some((re) => re.test(hay))) sum += f.selfMs
  }
  return sum
}
