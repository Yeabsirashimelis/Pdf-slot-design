import { describe, expect, it } from 'vitest'
import { chooseStep, rulerTicks } from '@/features/editor/canvas/rulerTicks'

describe('chooseStep', () => {
  it('picks the smallest 1-2-5 step whose labels are at least the minimum apart on screen', () => {
    expect(chooseStep(1, 60).major).toBe(100)
    expect(chooseStep(2, 60).major).toBe(50)
    expect(chooseStep(0.1, 60).major).toBe(1000)
    expect(chooseStep(4, 60).major).toBe(20)
  })

  it('subdivides: fifths for 1- and 5-series steps, quarters for 2-series', () => {
    expect(chooseStep(1, 60)).toEqual({ major: 100, minor: 20 })
    expect(chooseStep(2, 60)).toEqual({ major: 50, minor: 10 })
    expect(chooseStep(4, 60)).toEqual({ major: 20, minor: 5 })
  })
})

describe('rulerTicks', () => {
  it('places the page origin at the offset and labels every major tick, negatives included', () => {
    const ticks = rulerTicks(1, 100, 300, 60)
    const labelled = ticks.filter((t) => t.label !== null)
    expect(labelled.map((t) => [t.px, t.label])).toEqual([
      [0, '-100'],
      [100, '0'],
      [200, '100'],
    ])
  })

  it('emits minor ticks between the labelled ones, unlabelled', () => {
    const ticks = rulerTicks(1, 100, 300, 60)
    const between = ticks.filter((t) => t.px > 100 && t.px < 200)
    expect(between.map((t) => t.px)).toEqual([120, 140, 160, 180])
    expect(between.every((t) => t.label === null)).toBe(true)
  })

  it('scales tick spacing with the zoom', () => {
    const ticks = rulerTicks(2, 0, 400, 60)
    const labelled = ticks.filter((t) => t.label !== null)
    expect(labelled.map((t) => [t.px, t.label])).toEqual([
      [0, '0'],
      [100, '50'],
      [200, '100'],
      [300, '150'],
    ])
  })

  it('only emits ticks inside the ruler', () => {
    const ticks = rulerTicks(1, -250, 100, 60)
    expect(ticks.every((t) => t.px >= 0 && t.px < 100)).toBe(true)
    expect(ticks.some((t) => t.label === '300')).toBe(true)
  })

  it('never puts float noise into a label', () => {
    const ticks = rulerTicks(0.83, 13.37, 500, 60)
    for (const tick of ticks) if (tick.label !== null) expect(tick.label).toMatch(/^-?\d+$/)
  })
})
