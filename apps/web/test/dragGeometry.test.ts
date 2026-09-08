import { describe, expect, it } from 'vitest'
import type { Viewport } from '@pdf-slot/core'
import {
  MIN_SLOT_WIDTH,
  applyDragDelta,
  applyResizeDelta,
  clampWidth,
} from '../src/features/editor/overlay/dragGeometry'

describe('applyDragDelta', () => {
  it('converts a screen-pixel delta to PDF points via the viewport zoom', () => {
    const vp: Viewport = { zoom: 2, pageHeight: 800 }
    const origin = { x: 100, y: 200 }

    // 20 screen px right, 10 screen px down at zoom 2 => 10pt right, 5pt in PDF space.
    const result = applyDragDelta(origin, 20, 10, vp)

    expect(result.x).toBeCloseTo(110)
    // Screen Y down (positive dyScreen) must decrease PDF y (Y-up).
    expect(result.y).toBeCloseTo(195)
  })

  it('is a no-op for a zero delta', () => {
    const vp: Viewport = { zoom: 1.5, pageHeight: 800 }
    const origin = { x: 42, y: 99 }

    expect(applyDragDelta(origin, 0, 0, vp)).toEqual(origin)
  })

  it('recomputes from the fixed origin rather than accumulating -- same total delta gives the same result regardless of how many intermediate calls were made', () => {
    const vp: Viewport = { zoom: 1, pageHeight: 800 }
    const origin = { x: 0, y: 0 }

    const oneShot = applyDragDelta(origin, 30, 30, vp)

    // Simulate ten intermediate pointermove frames all reporting the delta
    // from the same fixed gesture-start origin (as SlotOverlay does) --
    // the result must be identical to the one-shot computation, proving
    // there is no per-frame accumulation to drift.
    let last = origin
    for (let i = 1; i <= 10; i++) {
      last = applyDragDelta(origin, (30 * i) / 10, (30 * i) / 10, vp)
    }

    expect(last).toEqual(oneShot)
  })

  it('a different zoom for the same screen delta yields a different PDF delta -- this is what stops drift on a zoom change', () => {
    const origin = { x: 0, y: 0 }

    const at1x = applyDragDelta(origin, 100, 0, { zoom: 1, pageHeight: 800 })
    const at2x = applyDragDelta(origin, 100, 0, { zoom: 2, pageHeight: 800 })

    expect(at1x.x).toBeCloseTo(100)
    expect(at2x.x).toBeCloseTo(50)
  })
})

describe('clampWidth / applyResizeDelta', () => {
  it('clampWidth never returns below the minimum', () => {
    expect(clampWidth(5)).toBe(MIN_SLOT_WIDTH)
    expect(clampWidth(-100)).toBe(MIN_SLOT_WIDTH)
    expect(clampWidth(1000)).toBe(1000)
  })

  it('applyResizeDelta converts screen delta to PDF points and adds it to the origin width', () => {
    const vp: Viewport = { zoom: 2, pageHeight: 800 }
    expect(applyResizeDelta(200, 40, vp)).toBeCloseTo(220)
  })

  it('applyResizeDelta clamps a large negative delta to the minimum width instead of going negative', () => {
    const vp: Viewport = { zoom: 1, pageHeight: 800 }
    expect(applyResizeDelta(50, -1000, vp)).toBe(MIN_SLOT_WIDTH)
  })

  it('applyResizeDelta respects a custom minimum', () => {
    const vp: Viewport = { zoom: 1, pageHeight: 800 }
    expect(applyResizeDelta(50, -1000, vp, 10)).toBe(10)
  })
})
