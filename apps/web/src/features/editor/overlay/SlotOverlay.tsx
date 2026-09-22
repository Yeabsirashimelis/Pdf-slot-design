// Hand-rolled rather than shadcn: this is a canvas-editor interaction
// primitive (pointer-captured drag and resize mapped into PDF coordinate
// space), and shadcn has no equivalent component. See CLAUDE.md. The
// name editor inside it and the size badge under it are shadcn's Input
// and Badge.
'use client'

import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent } from 'react'
import {
  FONT_CSS_FAMILY,
  PDF_APPLIES_KERNING,
  rgbToCss,
  toScreenLength,
  toScreenPoint,
  type FontMetrics,
  type Slot,
  type Viewport,
} from '@pdf-slot/core'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { SlotLines } from './SlotLines'
import { layoutSlot } from './slotBox'
import type { ResizeEdge } from './dragGeometry'
import { useSlotGestures } from './useSlotGestures'

/** Grab strips for the four resize edges, in screen px; see the JSX below. */
const RESIZE_EDGES: { edge: ResizeEdge; cursor: string; place(px: number): CSSProperties }[] = [
  { edge: 'left', cursor: 'ew-resize', place: (px) => ({ left: -px / 2, top: 0, bottom: 0, width: px }) },
  { edge: 'right', cursor: 'ew-resize', place: (px) => ({ right: -px / 2, top: 0, bottom: 0, width: px }) },
  { edge: 'top', cursor: 'ns-resize', place: (px) => ({ top: -px / 2, left: 0, right: 0, height: px }) },
  { edge: 'bottom', cursor: 'ns-resize', place: (px) => ({ bottom: -px / 2, left: 0, right: 0, height: px }) },
]
const RESIZE_STRIP_PX = 8
const SELECTION_OUTLINE_PX = 2

/** The inline name editor a freshly placed (or renamed) slot shows; see `naming` below. */
export type SlotNaming = {
  value: string
  onChange(value: string): void
  /** Enter or blur: keep the name (the parent decides what an empty one means). */
  onCommit(): void
  /** Escape: give up on the edit. */
  onCancel(): void
}

export function SlotOverlay({
  slot,
  name = '',
  viewport,
  screenScale = 1,
  metrics,
  selected,
  autoFocus = false,
  onFocused,
  onSelect,
  onChange,
  onCommit,
  textCommitted = false,
  locked = false,
  naming = null,
  onCloneStart,
}: {
  slot: Slot
  /** The slot's name: shown, in the slot's own typography, as a placeholder while it has no text. */
  name?: string
  /** The frame the stage is laid out in (zoom 1 on the infinite canvas). */
  viewport: Viewport
  /**
   * The CSS scale the stage is shown at on top of `viewport.zoom`. Pointer
   * deltas arrive in screen px and are divided by it; the strips, outline
   * and badge are sized against it so they stay the same size on screen
   * at any zoom.
   */
  screenScale?: number
  metrics: FontMetrics
  selected: boolean
  /** True for one render once this slot has been named: the caret moves into its text box. */
  autoFocus?: boolean
  /** Called once that focus has been given, so the caller can clear its one-shot flag. */
  onFocused?(): void
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
  /** The layout is frozen (the panel's padlock): the box can be typed into but not moved or resized. */
  locked?: boolean
  /** When set, the box shows an inline editor for its name instead of its text -- how a slot is named at placement, with no dialog. */
  naming?: SlotNaming | null
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

  // Naming a slot ends by handing it the caret, so what the user types
  // next is the slot's text. (Without it they are left looking at the
  // name-as-placeholder, which is not what gets exported.)
  useEffect(() => {
    if (!autoFocus) return
    textareaRef.current?.focus()
    onFocused?.()
  }, [autoFocus, onFocused])

  const { lines, boxHeight, placeholder } = layoutSlot(slot, metrics, name)

  const screenOrigin = toScreenPoint({ x: slot.x, y: slot.y }, viewport)
  const screenWidth = toScreenLength(slot.width, viewport)
  const screenHeight = toScreenLength(boxHeight, viewport)

  // While focused, the canvas is necessarily stale (it reflects the last
  // *committed* text, not each keystroke), so this slot's own DOM text stays
  // the source of truth for live feedback until it commits again. The
  // placeholder is never on the canvas, so it is always drawn here.
  const hideDomText = textCommitted && !focused && !placeholder

  const gestures = useSlotGestures({
    slot,
    boxHeight,
    // Pointer deltas are screen px; the stage is `screenScale` times
    // larger on screen than in its own frame.
    viewport: { zoom: viewport.zoom * screenScale, pageHeight: viewport.pageHeight },
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

  const handleNameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!naming) return
    if (event.key === 'Enter') {
      event.preventDefault()
      naming.onCommit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      naming.onCancel()
    }
  }

  // Everything that must look the same size on screen at any zoom is
  // sized in stage px against the screen scale.
  const px = (screen: number) => screen / screenScale
  const typography: CSSProperties = {
    fontFamily: FONT_CSS_FAMILY[slot.fontId],
    fontSize: toScreenLength(slot.size, viewport),
    lineHeight: slot.lineHeight,
    fontKerning: PDF_APPLIES_KERNING ? 'normal' : 'none',
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
        // accent, so a user can find the slots on a busy form without the
        // box competing with the document. Both are paint-only (no layout).
        backgroundColor: 'var(--slot-highlight)',
        boxShadow: `inset 0 0 0 ${px(1)}px var(--slot-highlight-edge)`,
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
        outline: selected ? `${px(SELECTION_OUTLINE_PX)}px solid var(--slot-selection)` : 'none',
        outlineOffset: -px(SELECTION_OUTLINE_PX),
      }}
    >
      {name && (
        <span
          data-testid="slot-label"
          style={{
            position: 'absolute',
            left: 0,
            bottom: '100%',
            // Sized in screen px and counter-scaled, so the tag reads the
            // same at 25% and at 400% -- it is chrome, not part of the page.
            transformOrigin: 'bottom left',
            transform: `scale(${px(1)})`,
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
          {name}
        </span>
      )}
      {!hideDomText && !naming && (
        <SlotLines
          slot={slot}
          lines={lines}
          viewport={viewport}
          metrics={metrics}
          // The placeholder is a hint in the slot's typography, but NEVER in
          // its ink: it is drawn in the box's own accent, the colour of the
          // chrome around it, because in the slot's colour it is
          // indistinguishable from text that would be exported -- a user
          // read their slot's name as their content, saved, and found the
          // download "missing" the text they never typed.
          color={placeholder ? 'color-mix(in srgb, var(--slot-selection) 70%, transparent)' : undefined}
          placeholder={placeholder}
        />
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
      {!naming && (
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
            ...typography,
            overflow: 'hidden',
            whiteSpace: 'pre-wrap',
            // The stage is user-select: none; the one place text is selectable is here.
            userSelect: 'text',
          }}
        />
      )}
      {/*
        Naming, Figma-style: the box itself is the editor. shadcn's Input
        with its chrome stripped, so what is typed sits exactly where the
        name will show and in the same typography. Enter keeps it, Escape
        gives up, and leaving the field keeps it too.
      */}
      {naming && (
        <Input
          autoFocus
          data-testid="slot-name-inline"
          aria-label="Slot name"
          placeholder="Name this slot"
          value={naming.value}
          onChange={(e) => naming.onChange(e.target.value)}
          onKeyDown={handleNameKeyDown}
          onBlur={naming.onCommit}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute inset-0 h-full w-full rounded-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
          style={{ ...typography, color: rgbToCss(slot.color), caretColor: rgbToCss(slot.color) }}
        />
      )}
      {/*
        One invisible grab strip along each edge, 8 screen px wide:
        left/right change the width (text re-wraps), top/bottom the box's
        minimum height. Each is centred on its edge so half of it sits
        outside the box, which keeps the strip grabbable on a one-line slot.
      */}
      {selected &&
        !locked &&
        RESIZE_EDGES.map(({ edge, cursor, place }) => (
          <div
            key={edge}
            data-resize-edge={edge}
            {...gestures.resize(edge)}
            style={{ position: 'absolute', pointerEvents: 'auto', cursor, ...place(px(RESIZE_STRIP_PX)) }}
          />
        ))}
      {/* The box's size in points, under it, as Figma prints a selection's. */}
      {selected && (
        <Badge
          data-testid="slot-size-badge"
          className="pointer-events-none absolute left-1/2 top-full select-none tabular-nums"
          style={{
            // Counter-scaled so the badge reads the same at every zoom;
            // the offset is 4 screen px below the box.
            transform: `translate(-50%, ${px(4)}px) scale(${1 / screenScale})`,
            transformOrigin: 'top center',
          }}
        >
          {Math.round(slot.width)} × {Math.round(boxHeight)}
        </Badge>
      )}
    </div>
  )
}
