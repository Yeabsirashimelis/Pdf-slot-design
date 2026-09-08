// Hand-rolled rather than shadcn: this is a canvas-editor interaction
// primitive (pointer-captured drag and resize mapped into PDF coordinate
// space), and shadcn has no equivalent component. See CLAUDE.md.
'use client'

import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent } from 'react'
import {
  FONT_CSS_FAMILY,
  PDF_APPLIES_KERNING,
  layoutHeight,
  layoutText,
  toScreenLength,
  toScreenPoint,
  type FontMetrics,
  type Slot,
  type Viewport,
} from '@pdf-slot/core'
import { SlotLines } from './SlotLines'
import { applyDragDelta, applyResizeDelta, type DragOrigin } from './dragGeometry'

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
  | {
      kind: 'resize'
      pointerId: number
      startScreen: { x: number; y: number }
      originWidth: number
    }

export function SlotOverlay({
  slot,
  viewport,
  metrics,
  selected,
  autoFocus,
  onFocused,
  onSelect,
  onChange,
  onCommit,
  textCommitted = false,
}: {
  slot: Slot
  viewport: Viewport
  metrics: FontMetrics
  selected: boolean
  /** True for exactly one render right after this slot was created by a canvas click. */
  autoFocus: boolean
  /** Called once autoFocus has been acted on, so the caller can clear its one-shot flag. */
  onFocused(): void
  onSelect(): void
  onChange(patch: Partial<Slot>): void
  /** Ends the current gesture (drag, resize, or text edit), closing its undo boundary. */
  onCommit(): void
  /**
   * True once the on-canvas render (pdf.js painting the real, committed PDF
   * bytes) reflects this slot's current text. While true and the slot isn't
   * focused, this overlay renders only its border/handles -- the glyphs the
   * user sees are the canvas's, not a DOM approximation of them. Rendering
   * both at once would show two overlapping (and not necessarily
   * pixel-identical) copies of the same text.
   */
  textCommitted?: boolean
}) {
  // A pointerdown on the body arms `pendingRef` without committing to
  // anything yet -- the textarea sits on top of (and covers) the entire
  // body, so every pointerdown here is *also* what natively focuses the
  // textarea for editing. `pendingRef` is only promoted to `dragRef` (a
  // real move-drag) once the pointer travels past DRAG_THRESHOLD_PX; a
  // release before that threshold is left alone as a plain click-to-edit.
  const pendingRef = useRef<PendingPointer | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [focused, setFocused] = useState(false)
  // Armed right before the drag-promotion blur below, so that blur's own
  // onBlur handler can tell "I was blurred to stop fighting a drag" apart
  // from "the user actually clicked/tabbed away" -- only the latter should
  // call onCommit(). Without this, a move-drag fired onCommit() twice (once
  // mid-drag from this blur, once for real at gesture end), paying for two
  // full renders (font subsetting included) per drag and splitting one
  // gesture into two undo entries.
  const suppressNextBlurCommitRef = useRef(false)

  useEffect(() => {
    if (autoFocus) {
      textareaRef.current?.focus()
      onFocused()
    }
    // If the parent passes a fresh onFocused identity each render, this
    // effect re-runs harmlessly (autoFocus is false on every render after
    // the one-shot focus already happened, so the body above is a no-op).
  }, [autoFocus, onFocused])

  const lines = layoutText(
    {
      text: slot.text,
      size: slot.size,
      width: slot.width,
      align: slot.align,
      lineHeight: slot.lineHeight,
      originX: slot.x,
      originY: slot.y,
    },
    metrics,
  )

  // An empty, freshly placed slot still needs a visible, clickable box to
  // type into -- layoutText([]) returns zero lines, which would otherwise
  // collapse the box to zero height.
  const lineCount = Math.max(1, lines.length)
  const boxHeight = layoutHeight(lineCount, slot.size, slot.lineHeight)

  const screenOrigin = toScreenPoint({ x: slot.x, y: slot.y }, viewport)
  const screenWidth = toScreenLength(slot.width, viewport)
  const screenHeight = toScreenLength(boxHeight, viewport)

  // While focused, the canvas is necessarily stale (it reflects the last
  // *committed* text, not each keystroke), so this slot's own DOM text stays
  // the source of truth for live feedback until it commits again.
  const hideDomText = textCommitted && !focused

  const endDrag = (pointerId: number) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== pointerId) return
    dragRef.current = null
    onCommit()
  }

  const handleBodyPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // A resize (or an already-promoted move, defensively) owns this
    // gesture; don't also arm a pending click/drag for it.
    if (dragRef.current) return
    // Deliberately no stopPropagation/preventDefault: this pointerdown's
    // natural target is the textarea on top, and its default action
    // (focusing it, so a plain click can type immediately) must still
    // happen. Capturing to the body div only changes where *subsequent*
    // pointer events for this pointerId are routed -- see
    // DRAG_THRESHOLD_PX's doc comment above.
    event.currentTarget.setPointerCapture(event.pointerId)
    pendingRef.current = {
      pointerId: event.pointerId,
      startScreen: { x: event.clientX, y: event.clientY },
      origin: { x: slot.x, y: slot.y },
    }
  }

  const handleBodyPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const pending = pendingRef.current
    if (pending && pending.pointerId === event.pointerId && !dragRef.current) {
      const dx = event.clientX - pending.startScreen.x
      const dy = event.clientY - pending.startScreen.y
      if (Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
        dragRef.current = {
          kind: 'move',
          pointerId: pending.pointerId,
          startScreen: pending.startScreen,
          origin: pending.origin,
        }
        onSelect()
        suppressNextBlurCommitRef.current = true
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
      onChange({ width: applyResizeDelta(drag.originWidth, dxScreen, viewport) })
    }
  }

  const handleBodyPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (pendingRef.current?.pointerId === event.pointerId) pendingRef.current = null
    endDrag(event.pointerId)
  }

  const handleResizePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    onSelect()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      kind: 'resize',
      pointerId: event.pointerId,
      startScreen: { x: event.clientX, y: event.clientY },
      originWidth: slot.width,
    }
  }

  // The resize handle is a child of the body div, so a captured pointer's
  // move/up events (redirected to the handle by setPointerCapture) would
  // still bubble up and re-trigger the body's own listeners for the same
  // event. Stopping propagation here is what keeps each pointermove/up
  // handled exactly once.
  const handleResizePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    handleBodyPointerMove(event)
  }

  const handleResizePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    endDrag(event.pointerId)
  }

  const handleTextChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onChange({ text: event.target.value })
  }

  return (
    <div
      data-slot-id={slot.id}
      onPointerDown={handleBodyPointerDown}
      onPointerMove={handleBodyPointerMove}
      onPointerUp={handleBodyPointerUp}
      onPointerCancel={handleBodyPointerUp}
      style={{
        position: 'absolute',
        left: screenOrigin.x,
        top: screenOrigin.y,
        width: screenWidth,
        height: screenHeight,
        pointerEvents: 'auto',
        cursor: 'move',
        border: selected ? '1px solid #0070f3' : '1px solid transparent',
        boxSizing: 'border-box',
      }}
    >
      {!hideDomText && <SlotLines slot={slot} lines={lines} viewport={viewport} metrics={metrics} />}
      {/*
        Invisible input surface layered over the rendered lines: its own
        text is transparent (only the caret is visible), so the glyphs the
        user actually sees are always SlotLines' one-span-per-line render --
        never this textarea's native, potentially-re-wrapped text node. It
        deliberately has no pointerdown handler of its own -- the body div's
        handler above both arms drag-detection and (by not calling
        preventDefault) leaves this element's native focus-on-click intact.

        Its own wrap geometry (which character falls on which row) is a
        SEPARATE concern from the invisible-text trick above, and matters
        for the caret alone: a click/keystroke's row is determined by the
        browser's own `white-space: pre-wrap` reflow of this element, not by
        `layoutText`. If this textarea measured text with a different font
        than `SlotLines` does, its wrap points -- and therefore the caret's
        row -- could disagree with where the glyphs the user is looking at
        actually break, even though the rendered glyphs themselves stay
        correct (SlotLines is unaffected either way). So every property that
        affects glyph advance widths or line spacing is mirrored from
        SlotLines/layoutText's inputs exactly: fontFamily (the same
        `@font-face` bytes, not the page's inherited Geist Sans),
        fontSize, fontKerning (must match PDF_APPLIES_KERNING for the same
        reason `layoutText`'s width measurement does -- see
        packages/core/src/layout/metrics.ts; ligature substitution is
        deliberately left at its default, because pdf-lib applies GSUB and
        so must the browser), and
        lineHeight as a unitless multiplier (`slot.lineHeight`), which -- since
        fontSize here is already toScreenLength(slot.size, viewport) --
        yields exactly toScreenLength(slot.size * slot.lineHeight, viewport)
        px per row, the same per-line step `layoutText` uses for baselineY.
      */}
      <textarea
        ref={textareaRef}
        value={slot.text}
        onChange={handleTextChange}
        onBlur={() => {
          setFocused(false)
          if (suppressNextBlurCommitRef.current) {
            // This blur was fired programmatically to clear the caret for
            // an in-progress drag, not by the user leaving the field --
            // the drag's own pointerup (endDrag) is the real commit point.
            suppressNextBlurCommitRef.current = false
            return
          }
          onCommit()
        }}
        // Selecting on focus (rather than only from a drag/resize gesture)
        // is what makes a plain click on an unselected slot show it as
        // selected (border, resize handle) even though the click's own
        // pointerdown never crosses the drag threshold.
        onFocus={() => {
          setFocused(true)
          onSelect()
        }}
        spellCheck={false}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          resize: 'none',
          border: 'none',
          outline: 'none',
          padding: 0,
          margin: 0,
          background: 'transparent',
          color: 'transparent',
          caretColor: `rgb(${slot.color.r * 255} ${slot.color.g * 255} ${slot.color.b * 255})`,
          fontFamily: FONT_CSS_FAMILY[slot.fontId],
          fontSize: toScreenLength(slot.size, viewport),
          lineHeight: slot.lineHeight,
          fontKerning: PDF_APPLIES_KERNING ? 'normal' : 'none',
          overflow: 'hidden',
          whiteSpace: 'pre-wrap',
        }}
      />
      {selected && (
        <div
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          onPointerCancel={handleResizePointerUp}
          style={{
            position: 'absolute',
            right: -4,
            top: 0,
            bottom: 0,
            width: 8,
            cursor: 'ew-resize',
            pointerEvents: 'auto',
          }}
        />
      )}
    </div>
  )
}
