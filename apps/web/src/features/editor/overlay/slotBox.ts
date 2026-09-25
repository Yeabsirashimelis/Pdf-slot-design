import {
  layoutHeight,
  layoutText,
  slotInset,
  slotLayout,
  type FontMetrics,
  type PositionedLine,
  type Slot,
} from '@pdf-slot/core'

/**
 * A slot's box as shown: the lines in it and its height, in PDF points --
 * the same numbers for the overlay that draws the box, the rulers that
 * mark its extent and the badge that prints its size.
 *
 * An empty slot shows its name as a placeholder, laid out with the very
 * same engine and typography as text would be, so the box is an honest
 * preview of the name's fit. `placeholder` is true when that is what the
 * lines hold; the export never sees it.
 */
export function layoutSlot(
  slot: Slot,
  metrics: FontMetrics,
  name = '',
): { lines: PositionedLine[]; boxHeight: number; placeholder: boolean } {
  const placeholder = slot.text === '' && name !== ''
  const lines = layoutText(slotLayout(slot, placeholder ? name : slot.text), metrics)
  // An empty, unnamed slot still needs a visible, clickable box --
  // layoutText('') returns zero lines, which would otherwise collapse the
  // box to zero height.
  const lineCount = Math.max(1, lines.length)
  // The box is as tall as its content (see layoutHeight: never shorter
  // than the glyphs, whatever the line height), or as tall as the user
  // dragged it (slot.height, a minimum) -- whichever is more.
  // The box has to hold the padding as well as the glyphs, or text
  // inset from the top would push out through the bottom.
  const textHeight = layoutHeight(lineCount, slot.size, slot.lineHeight, metrics) + slotInset(slot) * 2
  return { lines, boxHeight: Math.max(textHeight, slot.height ?? 0), placeholder }
}
