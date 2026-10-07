import { describe, expect, it } from 'vitest'
import { chooseStep } from '@/features/editor/canvas/rulerTicks'

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

  it('never runs off the end of the series at extreme zoom-out', () => {
    expect(chooseStep(0.0001, 60).major).toBe(10000)
  })
})
