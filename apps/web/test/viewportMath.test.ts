import { describe, expect, it } from 'vitest'
import {
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_PRESETS,
  clampZoom,
  fitPage,
  stepZoom,
  wheelZoomFactor,
  zoomAtCentre,
  zoomAtPoint,
  type ViewState,
} from '@/features/editor/canvas/viewportMath'

const view: ViewState = { zoom: 1, pan: { x: 100, y: 50 } }

describe('clampZoom', () => {
  it('keeps zoom inside [ZOOM_MIN, ZOOM_MAX]', () => {
    expect(clampZoom(0.01)).toBe(ZOOM_MIN)
    expect(clampZoom(99)).toBe(ZOOM_MAX)
    expect(clampZoom(1.5)).toBe(1.5)
  })
})

describe('zoomAtPoint', () => {
  it('keeps the page point under the cursor fixed while the zoom changes', () => {
    const cursor = { x: 300, y: 250 }
    // Page-space point under the cursor before: (300-100)/1, (250-50)/1 = (200, 200).
    const next = zoomAtPoint(view, cursor, 2)
    expect(next.zoom).toBe(2)
    // After: the same page point (200, 200) at zoom 2 must land on the cursor.
    expect(next.pan.x + 200 * 2).toBeCloseTo(cursor.x)
    expect(next.pan.y + 200 * 2).toBeCloseTo(cursor.y)
  })

  it('is exact in both directions: zooming in then out returns the original pan', () => {
    const cursor = { x: 37, y: 411 }
    const back = zoomAtPoint(zoomAtPoint(view, cursor, 2.7), cursor, 1)
    expect(back.pan.x).toBeCloseTo(view.pan.x)
    expect(back.pan.y).toBeCloseTo(view.pan.y)
  })

  it('clamps the requested zoom and, at the clamp, still anchors to the cursor', () => {
    const cursor = { x: 0, y: 0 }
    const next = zoomAtPoint(view, cursor, 1000)
    expect(next.zoom).toBe(ZOOM_MAX)
    expect(next.pan.x).toBeCloseTo(view.pan.x * ZOOM_MAX)
  })

  it('leaves the view untouched for the same zoom', () => {
    expect(zoomAtPoint(view, { x: 10, y: 10 }, 1)).toEqual(view)
  })
})

describe('zoomAtCentre', () => {
  it('anchors to the middle of the viewport', () => {
    const viewport = { width: 800, height: 600 }
    const direct = zoomAtPoint(view, { x: 400, y: 300 }, 2)
    expect(zoomAtCentre(view, viewport, 2)).toEqual(direct)
  })
})

describe('fitPage', () => {
  it('fits a portrait page to the viewport height and centres it horizontally', () => {
    const fit = fitPage({ width: 1000, height: 800 }, { width: 612, height: 792 }, 40)
    // Height is the binding constraint: (800 - 80) / 792.
    expect(fit.zoom).toBeCloseTo(720 / 792)
    const pageWidthPx = 612 * fit.zoom
    expect(fit.pan.x).toBeCloseTo((1000 - pageWidthPx) / 2)
    expect(fit.pan.y).toBeCloseTo(40)
  })

  it('fits a landscape page to the viewport width and centres it vertically', () => {
    const fit = fitPage({ width: 1000, height: 800 }, { width: 792, height: 612 }, 40)
    expect(fit.zoom).toBeCloseTo(920 / 792)
    expect(fit.pan.x).toBeCloseTo(40)
    expect(fit.pan.y).toBeCloseTo((800 - 612 * fit.zoom) / 2)
  })

  it('clamps the fitted zoom, keeping the page centred', () => {
    const fit = fitPage({ width: 20000, height: 20000 }, { width: 100, height: 100 })
    expect(fit.zoom).toBe(ZOOM_MAX)
    expect(fit.pan.x).toBeCloseTo((20000 - 100 * ZOOM_MAX) / 2)
  })

  it('never divides by zero: an unmeasured viewport yields 100% at the origin', () => {
    expect(fitPage({ width: 0, height: 0 }, { width: 612, height: 792 })).toEqual({ zoom: 1, pan: { x: 0, y: 0 } })
  })
})

describe('wheelZoomFactor', () => {
  it('scrolling up (negative deltaY) zooms in, down zooms out, symmetrically', () => {
    const inFactor = wheelZoomFactor(-100, 0)
    const outFactor = wheelZoomFactor(100, 0)
    expect(inFactor).toBeGreaterThan(1)
    expect(outFactor).toBeLessThan(1)
    expect(inFactor * outFactor).toBeCloseTo(1)
  })

  it('treats line-mode deltas (a mouse wheel in Firefox) as a few pixels each, not as one', () => {
    expect(wheelZoomFactor(-1, 1)).toBeGreaterThan(wheelZoomFactor(-1, 0))
  })

  it('caps one notch so a fast wheel cannot jump the whole range', () => {
    expect(wheelZoomFactor(-100000, 0)).toBeLessThanOrEqual(1.5)
    expect(wheelZoomFactor(100000, 0)).toBeGreaterThanOrEqual(1 / 1.5)
  })
})

describe('stepZoom', () => {
  it('goes to the next preset above or below the current zoom', () => {
    expect(stepZoom(1, 1)).toBe(ZOOM_PRESETS[ZOOM_PRESETS.indexOf(1) + 1])
    expect(stepZoom(1, -1)).toBe(ZOOM_PRESETS[ZOOM_PRESETS.indexOf(1) - 1])
  })

  it('from between two presets, steps to the nearer bound in that direction', () => {
    expect(stepZoom(0.83, 1)).toBe(1)
    expect(stepZoom(0.83, -1)).toBe(0.75)
  })

  it('stops at the ends of the range', () => {
    expect(stepZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX)
    expect(stepZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN)
  })
})
