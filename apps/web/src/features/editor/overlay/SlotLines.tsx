import {
  FONT_CSS_FAMILY,
  PDF_APPLIES_KERNING,
  toScreenLength,
  type FontMetrics,
  type PositionedLine,
  type Slot,
  type Viewport,
} from '@pdf-slot/core'

/**
 * Renders the layout engine's decision, one `PositionedLine` per
 * absolutely-positioned `<span>`, with `white-space: pre`. This is what
 * stops CSS re-wrapping text that `layoutText` (called by the caller, not
 * here) has already broken into lines -- one span per line means there is
 * never a run of text long enough, or a soft-wrap opportunity present, for
 * the browser to re-break.
 *
 * `fontKerning` is set to match exactly how pdf-lib measures and draws
 * text (see PDF_APPLIES_KERNING's doc comment in packages/core): pdf-lib
 * ignores GPOS kerning, so the browser must too, or advance widths would
 * disagree and preview would drift from download. Ligatures are the
 * opposite case and are deliberately NOT disabled here: pdf-lib runs
 * `font.layout()`, which applies GSUB `liga`, so the exported page really
 * does carry ligature glyphs and the overlay has to show the same ones.
 *
 * `left`/`top` are offsets relative to the slot's own top-left corner
 * (`slot.x`, `slot.y`) -- the caller (SlotOverlay) is expected to render
 * this inside a container already positioned at that corner on screen.
 */
export function SlotLines({
  slot,
  lines,
  viewport,
  metrics,
}: {
  slot: Slot
  lines: PositionedLine[]
  viewport: Viewport
  metrics: FontMetrics
}) {
  return (
    <>
      {lines.map((line, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            left: toScreenLength(line.x - slot.x, viewport),
            top: toScreenLength(slot.y - line.baselineY - metrics.ascender(slot.size), viewport),
            fontFamily: FONT_CSS_FAMILY[slot.fontId],
            fontSize: toScreenLength(slot.size, viewport),
            whiteSpace: 'pre',
            fontKerning: PDF_APPLIES_KERNING ? 'normal' : 'none',
            color: `rgb(${slot.color.r * 255} ${slot.color.g * 255} ${slot.color.b * 255})`,
          }}
        >
          {line.text}
        </span>
      ))}
    </>
  )
}
