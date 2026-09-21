import type { Point } from '@pdf-slot/core'

/**
 * The infinite canvas's view: how big the page is drawn (`zoom`, CSS px
 * per PDF point -- 1 is print size, what the zoom control shows as 100%)
 * and where its top-left corner sits in the viewport (`pan`, CSS px).
 *
 * Everything here is pure arithmetic on that pair. It is the part of the
 * editor most likely to silently break the preview/download invariant
 * (a slot placed under the cursor must land on the page point that was
 * under the cursor), so it lives in one tested module and the gesture
 * hook only ever calls these.
 */
export type ViewState = { zoom: number; pan: Point }
export type Size = { width: number; height: number }

export const ZOOM_MIN = 0.1
export const ZOOM_MAX = 4

/** The stops the −/+ buttons and the keyboard walk through. */
export const ZOOM_PRESETS: readonly number[] = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))
}

/**
 * Change the zoom so the page point under `cursor` (viewport px) stays
 * under it -- the pinch/ctrl-wheel behaviour. The page point is
 * `(cursor - pan) / zoom`; the new pan puts that same point back at the
 * cursor: `cursor - point * zoom'`. Derived from the current view each
 * time, never accumulated, so a long pinch cannot drift.
 */
export function zoomAtPoint(view: ViewState, cursor: Point, nextZoom: number): ViewState {
  const zoom = clampZoom(nextZoom)
  if (zoom === view.zoom) return view
  const ratio = zoom / view.zoom
  return {
    zoom,
    pan: {
      x: cursor.x - (cursor.x - view.pan.x) * ratio,
      y: cursor.y - (cursor.y - view.pan.y) * ratio,
    },
  }
}

/** The −/+ buttons and keyboard zoom: anchored to the middle of the viewport. */
export function zoomAtCentre(view: ViewState, viewport: Size, nextZoom: number): ViewState {
  return zoomAtPoint(view, { x: viewport.width / 2, y: viewport.height / 2 }, nextZoom)
}

/**
 * The view that shows the whole page as large as the viewport allows,
 * `padding` px clear of every edge, centred on the axis that has room to
 * spare. An unmeasured viewport (0 × 0, i.e. before layout) gets 100% at
 * the origin rather than a division by zero.
 */
export function fitPage(viewport: Size, page: Size, padding = 40): ViewState {
  if (viewport.width <= 0 || viewport.height <= 0 || page.width <= 0 || page.height <= 0) {
    return { zoom: 1, pan: { x: 0, y: 0 } }
  }
  const zoom = clampZoom(
    Math.min((viewport.width - 2 * padding) / page.width, (viewport.height - 2 * padding) / page.height),
  )
  return {
    zoom,
    pan: {
      x: (viewport.width - page.width * zoom) / 2,
      y: (viewport.height - page.height * zoom) / 2,
    },
  }
}

export function panBy(view: ViewState, dx: number, dy: number): ViewState {
  return { zoom: view.zoom, pan: { x: view.pan.x + dx, y: view.pan.y + dy } }
}

/** Pixels per line for `WheelEvent.deltaMode === DOM_DELTA_LINE` (Firefox with a mouse). */
const LINE_HEIGHT_PX = 16
/** Pixels of wheel travel for one e-fold of zoom; smaller is more sensitive. */
const WHEEL_PIXELS_PER_E = 200
/** One event can zoom by at most this factor, so a fast wheel is still a series of small steps. */
const WHEEL_MAX_FACTOR = 1.5

/**
 * Multiplicative zoom for one wheel event. Exponential in the delta, so
 * equal wheel travel gives equal *proportional* zoom at any scale and the
 * two directions cancel exactly. A trackpad pinch arrives as a ctrl+wheel
 * with small pixel deltas; a mouse wheel notch is ~100px (or 1-3 lines).
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  const px = deltaMode === 1 ? deltaY * LINE_HEIGHT_PX : deltaMode === 2 ? deltaY * LINE_HEIGHT_PX * 20 : deltaY
  const factor = Math.exp(-px / WHEEL_PIXELS_PER_E)
  return Math.min(WHEEL_MAX_FACTOR, Math.max(1 / WHEEL_MAX_FACTOR, factor))
}

/** The next preset above (+1) or below (−1) `zoom`; the ends of the range are sticky. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  // A hair of tolerance so a zoom that *is* a preset (bar float noise from
  // a fit) steps to the next one rather than "up" to itself.
  const eps = 1e-6
  if (direction > 0) {
    const next = ZOOM_PRESETS.find((preset) => preset > zoom + eps)
    return next ?? ZOOM_MAX
  }
  const below = ZOOM_PRESETS.filter((preset) => preset < zoom - eps)
  return below.length > 0 ? below[below.length - 1] : ZOOM_MIN
}

/** A viewport point as CSS px from the page's top-left corner (the "stage" the overlay is laid out in). */
export function toStagePoint(view: ViewState, viewportPoint: Point): Point {
  return { x: viewportPoint.x - view.pan.x, y: viewportPoint.y - view.pan.y }
}

export function toViewportPoint(view: ViewState, stagePoint: Point): Point {
  return { x: stagePoint.x + view.pan.x, y: stagePoint.y + view.pan.y }
}
