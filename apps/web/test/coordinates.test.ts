import { describe, expect, it } from 'vitest'
import { toLogicalPoint } from '../src/features/editor/canvas/coordinates'

describe('toLogicalPoint', () => {
  it('subtracts the rect origin from the client point', () => {
    const rect = { left: 50, top: 20 }
    const client = { x: 120, y: 80 }

    expect(toLogicalPoint(rect, client, 1)).toEqual({ x: 70, y: 60 })
  })

  it('does not vary with devicePixelRatio', () => {
    // getBoundingClientRect() always reports CSS pixels, regardless of dpr,
    // so the same rect/client pair must produce the same logical point
    // whether the display is 1x or 3x. If this function ever starts
    // reading `window.devicePixelRatio` to scale its result, this test
    // must fail.
    const rect = { left: 12, top: 8 }
    const client = { x: 212, y: 108 }

    const original = window.devicePixelRatio
    try {
      Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true })
      const at1x = toLogicalPoint(rect, client, 1)

      Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true })
      const at3x = toLogicalPoint(rect, client, 1)

      expect(at3x).toEqual(at1x)
    } finally {
      Object.defineProperty(window, 'devicePixelRatio', { value: original, configurable: true })
    }
  })

  it('does not vary with zoom', () => {
    // The canvas's CSS box already has zoom baked into its size, so `rect`
    // is already zoom-correct -- this conversion must not re-scale by zoom.
    const rect = { left: 0, top: 0 }
    const client = { x: 300, y: 150 }

    expect(toLogicalPoint(rect, client, 1)).toEqual(toLogicalPoint(rect, client, 4))
  })
})
