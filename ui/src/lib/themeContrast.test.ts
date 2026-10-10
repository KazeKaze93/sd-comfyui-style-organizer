import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

type Rgb = readonly [number, number, number]

const TOKEN_NAMES = [
  'bg',
  'surface',
  'popover',
  'border',
  'text',
  'muted',
  'accent',
  'accent-text',
  'success',
  'success-text',
  'danger',
  'danger-text',
  'warning-text',
  'info',
  'wildcard',
  'wildcard-text',
] as const

type TokenName = (typeof TOKEN_NAMES)[number]

const TEXT_ON_SURFACE: readonly TokenName[] = [
  'text',
  'muted',
  'accent-text',
  'success-text',
  'danger-text',
  'warning-text',
  'wildcard-text',
]

const SURFACES: readonly TokenName[] = ['bg', 'surface', 'popover']

const FILL_FOR_WHITE: readonly TokenName[] = ['accent', 'success', 'danger', 'info']

const WHITE: Rgb = [255, 255, 255]
const MIN_CONTRAST = 4.5

const CSS_PATH = join(dirname(fileURLToPath(import.meta.url)), '../index.css')

function linearize(channel: number): number {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const l1 = relativeLuminance(a)
  const l2 = relativeLuminance(b)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

function parseChannels(block: string): Record<TokenName, Rgb> {
  const out = {} as Record<TokenName, Rgb>
  for (const name of TOKEN_NAMES) {
    const re = new RegExp(`--sg-${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)\\s*;`)
    const m = block.match(re)
    if (!m) {
      throw new Error(`missing --sg-${name} in theme block`)
    }
    out[name] = [Number(m[1]), Number(m[2]), Number(m[3])]
  }
  return out
}

function extractThemeBlocks(css: string): { dark: string; light: string } {
  const rootMatch = css.match(/:root\s*\{([\s\S]*?)\n\s*\}/)
  if (!rootMatch) throw new Error('missing :root block')
  const lightMatch = css.match(/:root\[data-sg-theme="light"\]\s*\{([\s\S]*?)\n\s*\}/)
  if (!lightMatch) throw new Error('missing :root[data-sg-theme="light"] block')
  return { dark: rootMatch[1], light: lightMatch[1] }
}

describe('themeContrast', () => {
  const css = readFileSync(CSS_PATH, 'utf8')
  const blocks = extractThemeBlocks(css)

  for (const mode of ['dark', 'light'] as const) {
    describe(mode, () => {
      const tokens = parseChannels(blocks[mode])

      for (const text of TEXT_ON_SURFACE) {
        for (const surface of SURFACES) {
          it(`${text} on ${surface} >= ${MIN_CONTRAST}`, () => {
            const ratio = contrastRatio(tokens[text], tokens[surface])
            expect(ratio).toBeGreaterThanOrEqual(MIN_CONTRAST)
          })
        }
      }

      for (const fill of FILL_FOR_WHITE) {
        it(`white on ${fill} >= ${MIN_CONTRAST}`, () => {
          const ratio = contrastRatio(WHITE, tokens[fill])
          expect(ratio).toBeGreaterThanOrEqual(MIN_CONTRAST)
        })
      }
    })
  }
})
