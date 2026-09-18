// Hand-rolled rather than shadcn: this is a canvas-editor interaction
// primitive (pointer-captured drag and resize mapped into PDF coordinate
// space), and shadcn has no equivalent component. See CLAUDE.md.
'use client'

import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from 'react'
import {
  FONT_CSS_FAMILY,
  PDF_APPLIES_KERNING,
  rgbToCss,
  layoutHeight,
  layoutText,
  toScreenLength,
  toScreenPoint,
  type FontMetrics,
  type Slot,
  type Viewport,
} from '@pdf-slot/core'
import { SlotLines } from './SlotLines'
import { placeholderText } from './placeholder'
import type { ResizeEdge } from './dragGeometry'
import { useSlotGestures } from './useSlotGestures'

/** Grab strips for the four resize edges; see the JSX below. */
const RESIZE_EDGES: { edge: ResizeEdge; style: CSSProperties }[] = [
  { edge: 'left', style: { left: -4, top: 0, bottom: 0, width: 8, cursor: 'ew-resize' } },
  { edge: 'right', style: { right: -4, top: 0, bottom: 0, width: 8, cursor: 'ew-resize' } },
  { edge: 'top', style: { top: -4, left: 0, right: 0, height: 8, cursor: 'ns-resize' } },
  { edge: 'bottom', style: { bottom: -4, left: 0, right: 0, height: 8, cursor: 'ns-resize' } },
]

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
  locked = false,
  highlighted = false,
  readOnly = false,
  label,
  onCloneStart,
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
  /** `targetId` is set only while Alt+dragging: the patch is for the copy being dragged, not this slot. */
  onChange(patch: Partial<Slot>, targetId?: string): void
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
  /** Step 2: position, size and style are fixed -- only the text can change. */
  locked?: boolean
  /** Step 2: every slot is tinted so the user can see where to write. */
  highlighted?: boolean
  /**
   * Step 1: the box is about where, not what -- no text box is rendered,
   * so nothing can be typed and the arrow keys are free to nudge. Text
   * the slot already holds still shows (read-only) so its fit can be seen.
   */
  readOnly?: boolean
  /** The slot's name, shown as a small tag above the box so a box on a busy form is identifiable without the panel. */
  label?: string
  /**
   * Alt+drag (the Figma gesture): asked once, when the drag starts, for a
   * copy of this slot placed over it; returns the copy's id. The copy then
   * follows the pointer and this box stays put. Omitted: Alt+drag is a
   * plain drag.
   */
  onCloneStart?(): string | null
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (autoFocus) {
      textareaRef.current?.focus()
      onFocused()
    }
    // (With no textarea -- readOnly -- there is nothing to focus; the
    // one-shot flag is still cleared above so the parent's state settles.)
    // If the parent passes a fresh onFocused identity each render, this
    // effect re-runs harmlessly (autoFocus is false on every render after
    // the one-shot focus already happened, so the body above is a no-op).
  }, [autoFocus, onFocused])

  // Step 1, nothing written yet: show "Your <name> here…" in the slot's own
  // font and size so its fit can be judged. Laid out and drawn exactly like
  // real text (same engine, same spans), only faded -- and only on screen:
  // `slot.text` stays empty and the PDF never sees it.
  const placeholder = readOnly && slot.text === '' && label ? placeholderText(label) : null
  const shownText = placeholder ?? slot.text

  const lines = layoutText(
    {
      text: shownText,
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
  // The box is as tall as its text, or as tall as the user dragged it
  // (slot.height, a minimum) -- whichever is more.
  const textHeight = layoutHeight(lineCount, slot.size, slot.lineHeight)
  const boxHeight = Math.max(textHeight, slot.height ?? 0)

  const screenOrigin = toScreenPoint({ x: slot.x, y: slot.y }, viewport)
  const screenWidth = toScreenLength(slot.width, viewport)
  const screenHeight = toScreenLength(boxHeight, viewport)

  // While focused, the canvas is necessarily stale (it reflects the last
  // *committed* text, not each keystroke), so this slot's own DOM text stays
  // the source of truth for live feedback until it commits again.
  const hideDomText = textCommitted && !focused

  const gestures = useSlotGestures({
    slot,
    boxHeight,
    viewport,
    locked,
    textareaRef,
    onSelect,
    onChange,
    onCommit,
    onCloneStart,
  })

  const handleTextChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onChange({ text: event.target.value })
  }

  return (
    <div
      data-slot-id={slot.id}
      {...gestures.body}
      style={{
        position: 'absolute',
        left: screenOrigin.x,
        top: screenOrigin.y,
        width: screenWidth,
        height: screenHeight,
        pointerEvents: 'auto',
        cursor: locked ? 'text' : 'move',
        // Theme tokens (globals.css) so the overlay follows the app's palette.
        // Every slot is visibly a box: a light wash and a hairline in the
        // theme's ink, so a user can find the slots on a busy form without
        // the box competing with the document. Step 2 (`highlighted`) uses
        // a slightly deeper wash. Both are paint-only (no layout).
        backgroundColor: highlighted ? 'var(--slot-highlight-strong)' : 'var(--slot-highlight)',
        boxShadow: 'inset 0 0 0 1px var(--slot-highlight-edge)',
        // An outline (drawn inward), NOT a border. Absolutely positioned
        // children -- the textarea at `inset: 0` and SlotLines' spans --
        // are placed against this box's *padding* box, and a border (even
        // a transparent one) shrinks that by its width on every side. That
        // left the textarea 2px narrower and shorter than the slot
        // `layoutText` laid out: it wrapped a row earlier than the spans
        // and then scrolled internally to keep its caret visible, which is
        // the caret/line jump seen while typing. It also shifted every
        // glyph 1px right and down from the slot's true origin. An outline
        // paints over the box without taking part in layout, so all three
        // (box, textarea, spans) keep exactly the same rectangle.
        outline: selected ? '2px solid var(--slot-selection)' : 'none',
        outlineOffset: -2,
      }}
    >
      {label && (
        <span
          data-testid="slot-label"
          style={{
            position: 'absolute',
            left: 0,
            bottom: '100%',
            marginBottom: 2,
            padding: '0 4px',
            fontSize: 10,
            lineHeight: '14px',
            fontFamily: 'var(--font-sans)',
            color: 'var(--slot-selection)',
            background: 'var(--card)',
            border: '1px solid var(--slot-highlight-edge)',
            borderRadius: 3,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          {label}
        </span>
      )}
      {placeholder ? (
        <div data-testid="slot-placeholder" style={{ opacity: 0.45 }}>
          <SlotLines slot={{ ...slot, text: placeholder }} lines={lines} viewport={viewport} metrics={metrics} />
        </div>
      ) : (
        !hideDomText && <SlotLines slot={slot} lines={lines} viewport={viewport} metrics={metrics} />
      )}
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
      {!readOnly && (
        <textarea
          ref={textareaRef}
          value={slot.text}
          onChange={handleTextChange}
          onBlur={() => {
            setFocused(false)
            // A blur fired to clear the caret for an in-progress drag is not
            // the user leaving the field -- the drag's pointerup commits.
            if (gestures.consumeDragBlur()) return
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
            caretColor: rgbToCss(slot.color),
            fontFamily: FONT_CSS_FAMILY[slot.fontId],
            fontSize: toScreenLength(slot.size, viewport),
            lineHeight: slot.lineHeight,
            fontKerning: PDF_APPLIES_KERNING ? 'normal' : 'none',
            overflow: 'hidden',
            whiteSpace: 'pre-wrap',
            // The stage is user-select: none; the one place text is selectable is here.
            userSelect: 'text',
          }}
        />
      )}
      {/*
        One 8px-wide invisible grab strip along each edge (step 1 only):
        left/right change the width (text re-wraps), top/bottom the box's
        minimum height. Each is centred on its edge so half of it sits
        outside the box, which keeps the strip grabbable on a one-line slot.
      */}
      {selected &&
        !locked &&
        RESIZE_EDGES.map(({ edge, style }) => (
          <div
            key={edge}
            data-resize-edge={edge}
            {...gestures.resize(edge)}
            style={{ position: 'absolute', pointerEvents: 'auto', ...style }}
          />
        ))}
    </div>
  )
}
