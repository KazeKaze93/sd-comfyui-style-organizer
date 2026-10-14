import { describe, expect, it } from 'vitest'
import constantsSource from './constants.ts?raw'
import { autoFillGridClass, minCardWidthPx } from './constants'

const COMBOS: ReadonlyArray<readonly [boolean, boolean]> = [
  [false, false],
  [false, true],
  [true, false],
  [true, true],
]

describe('autoFillGridClass', () => {
  it.each(COMBOS)(
    'includes minmax for compact=%s windowed=%s matching minCardWidthPx',
    (compact, windowed) => {
      const minW = minCardWidthPx(compact, windowed)
      expect(autoFillGridClass(compact, windowed)).toContain(`minmax(${minW}px,1fr)`)
    },
  )

  it.each(COMBOS)(
    'every utility for compact=%s windowed=%s is a literal substring of constants.ts',
    (compact, windowed) => {
      const result = autoFillGridClass(compact, windowed)
      for (const utility of result.split(' ')) {
        expect(constantsSource).toContain(utility)
      }
    },
  )

  it('no combo result contains a template placeholder', () => {
    for (const [compact, windowed] of COMBOS) {
      expect(autoFillGridClass(compact, windowed)).not.toContain('${')
    }
  })
})
