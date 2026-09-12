import { FONT_IDS, type Align, type FontId, type RGB, type Slot } from '@pdf-slot/core'

/** The part of a slot a user *chooses* (as opposed to where it is and what it says). */
export type SlotStyle = Pick<Slot, 'fontId' | 'size' | 'color' | 'align'>

export const SLOT_STYLE_KEY = 'pdf-slot-editor:last-slot-style'

const ALIGNS: readonly Align[] = ['left', 'center', 'right']

/**
 * Remembers the style of the slot the user just restyled, so the next slot
 * they place starts from it rather than from the factory defaults --
 * someone filling a form in 10pt red serif should not re-pick that for
 * every field. localStorage, so it survives a reload and "Start over";
 * never throws, since a private-browsing tab or a blocked store must
 * degrade to "defaults again", not a broken editor.
 */
export function rememberSlotStyle(slot: SlotStyle): void {
  const { fontId, size, color, align } = slot
  try {
    localStorage.setItem(SLOT_STYLE_KEY, JSON.stringify({ fontId, size, color, align }))
  } catch {
    // Storage unavailable or full: the next slot simply gets the defaults.
  }
}

/**
 * The remembered style, field by field -- each one only if it is present
 * and valid, so a stale or hand-edited value can never put a font the
 * bundle doesn't have, or a colour outside pdf-lib's 0-1 range, into a
 * slot (either of which would break the export).
 */
export function recallSlotStyle(): Partial<SlotStyle> {
  let raw: unknown
  try {
    const stored = localStorage.getItem(SLOT_STYLE_KEY)
    if (!stored) return {}
    raw = JSON.parse(stored)
  } catch {
    return {}
  }
  if (typeof raw !== 'object' || raw === null) return {}
  const value = raw as Record<string, unknown>
  const style: Partial<SlotStyle> = {}
  if (isFontId(value.fontId)) style.fontId = value.fontId
  if (isPositiveFinite(value.size)) style.size = value.size
  if (isRgb(value.color)) style.color = { r: value.color.r, g: value.color.g, b: value.color.b }
  if (isAlign(value.align)) style.align = value.align
  return style
}

function isFontId(v: unknown): v is FontId {
  return typeof v === 'string' && (FONT_IDS as readonly string[]).includes(v)
}

function isPositiveFinite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}

function isUnit(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
}

function isRgb(v: unknown): v is RGB {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Record<string, unknown>
  return isUnit(c.r) && isUnit(c.g) && isUnit(c.b)
}

function isAlign(v: unknown): v is Align {
  return typeof v === 'string' && (ALIGNS as readonly string[]).includes(v)
}
