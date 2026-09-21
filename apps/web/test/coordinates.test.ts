import { describe, expect, it } from 'vitest'
import { toStagePoint } from '../src/features/editor/canvas/coordinates'

describe('toStagePoint', () => {
  it('subtracts the rect origin from the client point', () => {
    const rect = { left: 50, top: 20 }
    const client = { x: 120, y: 80 }

    expect(toStagePoint(rect, client, 1)).toEqual({ x: 70, y: 60 })
  })

  it('does not vary with devicePixelRatio', () => {
    // getBoundingClientRect() always reports CSS pixels, regardless of dpr,
    // so the same rect/client pair must produce the same stage point
    // whether the display is 1x or 3x. If this function ever starts
    // reading `window.devicePixelRatio` to scale its result, this test
    // must fail.
    const rect = { left: 12, top: 8 }
    const client = { x: 212, y: 108 }

    const original = window.devicePixelRatio
    try {
      Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true })
      const at1x = toStagePoint(rect, client, 1)

      Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true })
      const at3x = toStagePoint(rect, client, 1)

      expect(at3x).toEqual(at1x)
    } finally {
      Object.defineProperty(window, 'devicePixelRatio', { value: original, configurable: true })
    }
  })

  it('divides the screen distance by the screen scale', () => {
    // The stage is laid out at 1px per point and CSS-scaled on screen; the
    // rect is the *scaled* box, so a click 300px into a 2x-scaled page is
    // 150 stage px (150pt) from its corner.
    const rect = { left: 0, top: 0 }
    const client = { x: 300, y: 150 }

    expect(toStagePoint(rect, client, 2)).toEqual({ x: 150, y: 75 })
    expect(toStagePoint(rect, client, 0.5)).toEqual({ x: 600, y: 300 })
  })
})
