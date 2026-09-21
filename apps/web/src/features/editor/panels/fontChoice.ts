import type { FontId } from '@pdf-slot/core'

/**
 * The inspector shows a font as Figma does -- a family and a weight --
 * while the document model has one `FontId` per bundled face. These map
 * between the two. Mono ships in one weight, so its weight control is
 * disabled and a bold request falls back to regular.
 */
export type FontFamily = 'sans' | 'serif' | 'mono'
export type FontWeight = 'regular' | 'bold'

export const FONT_FAMILIES: readonly { value: FontFamily; label: string }[] = [
  { value: 'sans', label: 'Sans' },
  { value: 'serif', label: 'Serif' },
  { value: 'mono', label: 'Mono' },
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
