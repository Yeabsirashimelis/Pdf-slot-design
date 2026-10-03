import type { FontId } from '@pdf-slot/core'

/**
 * The inspector shows a font as Figma does -- a family and a weight --
 * while the document model has one `FontId` per bundled face. These map
 * between the two. Mono ships in one weight, so its weight control is
 * disabled and a bold request falls back to regular.
 */
export type FontFamily = 'sans' | 'serif' | 'mono'
export type FontWeight = 'regular' | 'bold'

/**
 * Named after the typeface, not the role it plays. "Sans" tells a user
 * nothing about what will be printed, and someone asked for a particular
 * face has no way to see they got it. The stored `FontId` is still
 * `sans`/`serif`/`mono`, so what a document records does not change when
 * one of these is swapped for another -- only what the menu says.
 */
export const FONT_FAMILIES: readonly { value: FontFamily; label: string }[] = [
  { value: 'sans', label: 'Inter' },
  { value: 'serif', label: 'PT Serif' },
  { value: 'mono', label: 'IBM Plex Mono' },
]

export const FONT_WEIGHTS: readonly { value: FontWeight; label: string }[] = [
  { value: 'regular', label: 'Regular' },
  { value: 'bold', label: 'Bold' },
]

export function toFontChoice(fontId: FontId): { family: FontFamily; weight: FontWeight } {
  const [family, weight] = fontId.split('-') as [FontFamily, string | undefined]
  return { family, weight: weight === 'bold' ? 'bold' : 'regular' }
}

export function hasBold(family: FontFamily): boolean {
  return family !== 'mono'
}

export function toFontId(family: FontFamily, weight: FontWeight): FontId {
  return weight === 'bold' && hasBold(family) ? (`${family}-bold` as FontId) : family
}
