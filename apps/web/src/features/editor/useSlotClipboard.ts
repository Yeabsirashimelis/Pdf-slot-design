'use client'

import { useRef } from 'react'
import { toPdfPoint, type Slot, type Viewport } from '@pdf-slot/core'
import type { LogicalPoint } from './canvas/coordinates'

/** A copied slot: every setting, plus its name so the paste can be named after it. */
export type SlotClipboard = { slot: Slot; label?: string }

export type PasteTarget = { page: number; x: number; y: number }

/** Where a repeat paste with no pointer over the page lands, relative to the previous one (PDF points). */
export const PASTE_OFFSET = 12

/**
 * The editor's in-app clipboard for slots (Ctrl/Cmd+C / Ctrl/Cmd+V). Not
 * the OS clipboard: a slot is geometry and style, not text, and the
 * browser's clipboard API would need a permission prompt for nothing.
 *
 * A paste lands on the current page, under the pointer when it is over
 * the page (the Figma behaviour), otherwise 12pt right and down from where
 * the last copy/paste was, so repeated pastes cascade instead of stacking.
 * The clipboard outlives its source: deleting the copied slot does not
 * empty it.
 */
export function useSlotClipboard() {
  const clipboardRef = useRef<SlotClipboard | null>(null)

  return {
    copy(slot: Slot, label?: string) {
      clipboardRef.current = { slot: { ...slot }, label }
    },
    /** Null when nothing has been copied yet. Advances the fallback position for the next paste. */
    take(pointer: LogicalPoint | null, viewport: Viewport, page: number): (SlotClipboard & { target: PasteTarget }) | null {
      const held = clipboardRef.current
      if (!held) return null
      const target: PasteTarget = pointer
        ? { page, ...toPdfPoint(pointer, viewport) }
        : { page, x: held.slot.x + PASTE_OFFSET, y: held.slot.y - PASTE_OFFSET }
      clipboardRef.current = { ...held, slot: { ...held.slot, x: target.x, y: target.y } }
      return { ...held, target }
    },
  }
}
