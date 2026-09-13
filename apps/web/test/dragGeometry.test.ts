import { describe, expect, it } from 'vitest'
import type { Viewport } from '@pdf-slot/core'
import {
  MIN_SLOT_WIDTH,
  applyDragDelta,
  applyEdgeResize,
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

describe('applyEdgeResize', () => {
  // A 100x40 box at PDF (100, 500) (y is the TOP edge, Y-up), at zoom 2:
  // every 2 screen px is 1 PDF point.
  const vp: Viewport = { zoom: 2, pageHeight: 800 }
  const origin = { x: 100, y: 500, width: 100, height: 40 }

  it('right edge: dragging right widens, the origin corner stays put', () => {
    expect(applyEdgeResize('right', origin, 20, 0, vp)).toEqual({ width: 110 })
  })

  it('left edge: dragging right moves the left edge in and narrows by the same amount', () => {
    expect(applyEdgeResize('left', origin, 20, 0, vp)).toEqual({ x: 110, width: 90 })
  })

  it('bottom edge: dragging down grows the height', () => {
    expect(applyEdgeResize('bottom', origin, 0, 20, vp)).toEqual({ height: 50 })
  })

  it('top edge: dragging down lowers the top (PDF y decreases) and shrinks the height', () => {
    expect(applyEdgeResize('top', origin, 0, 20, vp)).toEqual({ y: 490, height: 30 })
  })

  it('width never goes below MIN_SLOT_WIDTH, and the right edge stays put on a left-edge resize', () => {
    const result = applyEdgeResize('left', origin, 400, 0, vp)
    expect(result.width).toBe(MIN_SLOT_WIDTH)
    expect(result.x! + result.width!).toBeCloseTo(origin.x + origin.width)
  })

  it('height never goes below zero (zero means "as tall as the text"), and the bottom edge stays put on a top-edge resize', () => {
    const result = applyEdgeResize('top', origin, 0, 400, vp)
    expect(result.height).toBe(0)
    expect(result.y! - result.height!).toBeCloseTo(origin.y - origin.height)
  })

  it('recomputes from the fixed origin, never accumulating', () => {
    expect(applyEdgeResize('bottom', origin, 0, 10, vp)).toEqual({ height: 45 })
    expect(applyEdgeResize('bottom', origin, 0, 20, vp)).toEqual({ height: 50 })
  })
})
