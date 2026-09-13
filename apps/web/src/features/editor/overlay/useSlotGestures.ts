'use client'

import { useRef, type PointerEvent } from 'react'
import type { Slot, Viewport } from '@pdf-slot/core'
import { applyDragDelta, applyEdgeResize, type DragOrigin, type ResizeEdge, type ResizeOrigin } from './dragGeometry'

/**
 * Screen pixels of pointer movement before a pointerdown on the body is
 * treated as a drag rather than a click. Below this, releasing the pointer
 * leaves the click's native effect (focusing the textarea under it, so the
 * user can type) alone; at or above it, the gesture becomes a move-drag and
 * the textarea is blurred so the drag isn't fighting a text caret/selection.
 */
const DRAG_THRESHOLD_PX = 4

type PendingPointer = { pointerId: number; startScreen: { x: number; y: number }; origin: DragOrigin }

type DragState =
  | { kind: 'move'; pointerId: number; startScreen: { x: number; y: number }; origin: DragOrigin }
  | { kind: 'resize'; edge: ResizeEdge; pointerId: number; startScreen: { x: number; y: number }; origin: ResizeOrigin }

type Handlers = {
  onPointerDown(event: PointerEvent<HTMLDivElement>): void
  onPointerMove(event: PointerEvent<HTMLDivElement>): void
  onPointerUp(event: PointerEvent<HTMLDivElement>): void
  onPointerCancel(event: PointerEvent<HTMLDivElement>): void
}

/**
 * The move-drag and edge-resize gestures of one slot box, as pointer
 * handlers for the body div and for each resize strip. Owns no React
 * state: gestures live in refs, and every pointermove reports the box's
 * new geometry through `onChange` (recomputed from the gesture's fixed
 * origin -- see dragGeometry.ts), with `onCommit` once at pointerup.
 *
 * A pointerdown on the body arms a *pending* pointer without committing
 * to anything: the textarea sits on top of the body, so that pointerdown
 * is also what natively focuses it for typing. The pending pointer is
 * promoted to a real move-drag only past DRAG_THRESHOLD_PX; a release
 * before that is left alone as a plain click-to-edit. When it is
 * promoted, the textarea is blurred (so the drag isn't fighting a caret)
 * and a flag is armed so the textarea's blur handler (via
 * `consumeDragBlur`) can tell "blurred for a drag" from "the user left
 * the field" -- only the latter commits; the drag's pointerup is the real
 * commit point.
 */
export function useSlotGestures({
  slot,
  boxHeight,
  viewport,
  locked,
  textareaRef,
  onSelect,
  onChange,
  onCommit,
}: {
  slot: Slot
  /** The box as shown (text height or the stored minimum), so a top/bottom resize starts from the visible edge. */
  boxHeight: number
  viewport: Viewport
  locked: boolean
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  onSelect(): void
  onChange(patch: Partial<Slot>): void
  onCommit(): void
}): {
  body: Handlers
  resize(edge: ResizeEdge): Handlers
  /**
   * For the textarea's onBlur: true (once) when the blur was fired by a
   * drag promotion rather than by the user leaving the field, in which
   * case the blur must not commit -- the drag's pointerup will.
   */
  consumeDragBlur(): boolean
} {
  const pendingRef = useRef<PendingPointer | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const suppressNextBlurCommit = useRef(false)

  const endDrag = (pointerId: number) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== pointerId) return
    dragRef.current = null
    onCommit()
  }

  const handleBodyPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (locked) return
    // A resize (or an already-promoted move, defensively) owns this
    // gesture; don't also arm a pending click/drag for it.
    if (dragRef.current) return
    // Deliberately no stopPropagation/preventDefault: this pointerdown's
    // natural target is the textarea on top, and its default action
    // (focusing it) must still happen. Capturing to the body div only
    // changes where *subsequent* pointer events for this pointerId go.
    event.currentTarget.setPointerCapture(event.pointerId)
    pendingRef.current = {
      pointerId: event.pointerId,
      startScreen: { x: event.clientX, y: event.clientY },
      origin: { x: slot.x, y: slot.y },
    }
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const pending = pendingRef.current
    if (pending && pending.pointerId === event.pointerId && !dragRef.current) {
      const dx = event.clientX - pending.startScreen.x
      const dy = event.clientY - pending.startScreen.y
      if (Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
        dragRef.current = { kind: 'move', pointerId: pending.pointerId, startScreen: pending.startScreen, origin: pending.origin }
        onSelect()
        suppressNextBlurCommit.current = true
        textareaRef.current?.blur()
      }
    }

    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dxScreen = event.clientX - drag.startScreen.x
    const dyScreen = event.clientY - drag.startScreen.y
    if (drag.kind === 'move') {
      onChange(applyDragDelta(drag.origin, dxScreen, dyScreen, viewport))
    } else {
      onChange(applyEdgeResize(drag.edge, drag.origin, dxScreen, dyScreen, viewport))
    }
  }

  const handleBodyPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (pendingRef.current?.pointerId === event.pointerId) pendingRef.current = null
    endDrag(event.pointerId)
  }

  const resize = (edge: ResizeEdge): Handlers => ({
    onPointerDown(event) {
      if (locked) return
      event.stopPropagation()
      onSelect()
      event.currentTarget.setPointerCapture(event.pointerId)
      dragRef.current = {
        kind: 'resize',
        edge,
        pointerId: event.pointerId,
        startScreen: { x: event.clientX, y: event.clientY },
        origin: { x: slot.x, y: slot.y, width: slot.width, height: boxHeight },
      }
    },
    // The strips are children of the body div, so a captured pointer's
    // move/up events (redirected to the strip by setPointerCapture) would
    // still bubble up and re-trigger the body's own listeners for the same
    // event. Stopping propagation keeps each pointermove/up handled once.
    onPointerMove(event) {
      event.stopPropagation()
      handlePointerMove(event)
    },
    onPointerUp(event) {
      event.stopPropagation()
      endDrag(event.pointerId)
    },
    onPointerCancel(event) {
      event.stopPropagation()
      endDrag(event.pointerId)
    },
  })

  return {
    body: {
      onPointerDown: handleBodyPointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handleBodyPointerUp,
      onPointerCancel: handleBodyPointerUp,
    },
    resize,
    consumeDragBlur() {
      const suppressed = suppressNextBlurCommit.current
      suppressNextBlurCommit.current = false
      return suppressed
    },
  }
}
