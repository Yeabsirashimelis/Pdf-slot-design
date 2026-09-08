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
