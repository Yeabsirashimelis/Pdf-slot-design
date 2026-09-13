import { toPdfLength, type Point, type Viewport } from '@pdf-slot/core'

/**
 * Minimum slot width, in PDF points. Keeps a dragged-in resize handle from
 * collapsing the box to zero (or negative) width.
 */
export const MIN_SLOT_WIDTH = 24

export type DragOrigin = { x: number; y: number }

/**
 * Compute a slot's new PDF-space top-left corner from a drag gesture's
 * total screen-pixel displacement, measured from the gesture's start.
 *
 * Deliberately NOT incremental: this always recomputes from the fixed
 * `origin` captured once at pointerdown (`origin.x + delta`), rather than
 * adding each pointermove's small delta onto the previous frame's already-
 * converted PDF position. Accumulating screen pixels (or accumulating many
 * small toPdfLength() roundings) into state is exactly the kind of drift
 * this module exists to avoid -- recomputing from one fixed origin every
 * frame means per-frame rounding can never compound, and the box always
 * lands exactly `toPdfLength(totalScreenDelta)` from where the drag began.
 */
export function applyDragDelta(
  origin: DragOrigin,
  dxScreen: number,
  dyScreen: number,
  vp: Viewport,
): Point {
  return {
    x: origin.x + toPdfLength(dxScreen, vp),
    // Screen Y increases downward; PDF Y increases upward, so moving the
    // pointer down (positive dyScreen) must decrease PDF y.
    y: origin.y - toPdfLength(dyScreen, vp),
  }
}

export function clampWidth(width: number, min: number = MIN_SLOT_WIDTH): number {
  return Math.max(min, width)
}

/**
 * Compute a slot's new width from a horizontal-resize gesture's total
 * screen-pixel displacement, measured from the gesture's start (same
 * fixed-origin reasoning as `applyDragDelta`), clamped to `min`.
 */
export function applyResizeDelta(
  originWidth: number,
  dxScreen: number,
  vp: Viewport,
  min: number = MIN_SLOT_WIDTH,
): number {
  return clampWidth(originWidth + toPdfLength(dxScreen, vp), min)
}

export type ResizeEdge = 'left' | 'right' | 'top' | 'bottom'

/** The box as it was at pointerdown: PDF points, `y` the TOP edge (Y-up). */
export type ResizeOrigin = { x: number; y: number; width: number; height: number }

/**
 * Compute the patch for dragging one edge of a slot's box by a gesture's
 * total screen-pixel displacement (same fixed-origin reasoning as
 * `applyDragDelta`). The opposite edge never moves:
 *
 * - `right`/`bottom` change only `width`/`height`.
 * - `left` moves `x` and shrinks `width` by the same amount; `top` moves
 *   `y` (PDF Y-up: dragging down lowers it) and shrinks `height`.
 *
 * Width clamps to `MIN_SLOT_WIDTH`; height clamps to 0, which means "as
 * tall as the text" -- the box height is a *minimum*, the writing area a
 * user sees in step 2, and text that overflows it still grows the box.
 * When a clamp hits, the dragged edge stops and the far edge stays put.
 */
export function applyEdgeResize(
  edge: ResizeEdge,
  origin: ResizeOrigin,
  dxScreen: number,
  dyScreen: number,
  vp: Viewport,
): Partial<ResizeOrigin> {
  const dx = toPdfLength(dxScreen, vp)
  const dy = toPdfLength(dyScreen, vp)
  switch (edge) {
    case 'right':
      return { width: clampWidth(origin.width + dx) }
    case 'left': {
      const width = clampWidth(origin.width - dx)
      return { x: origin.x + origin.width - width, width }
    }
    case 'bottom':
      return { height: Math.max(0, origin.height + dy) }
    case 'top': {
      const height = Math.max(0, origin.height - dy)
      return { y: origin.y - origin.height + height, height }
    }
  }
}
