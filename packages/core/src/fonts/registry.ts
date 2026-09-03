export type FontId = 'sans' | 'sans-bold' | 'serif' | 'serif-bold' | 'mono'

export const FONT_IDS: readonly FontId[] = [
  'sans', 'sans-bold', 'serif', 'serif-bold', 'mono',
] as const

export const FONT_FILES: Record<FontId, string> = {
  sans: 'PT_Sans-Web-Regular.ttf',
  'sans-bold': 'PT_Sans-Web-Bold.ttf',
  serif: 'PT_Serif-Web-Regular.ttf',
  'serif-bold': 'PT_Serif-Web-Bold.ttf',
  mono: 'IBMPlexMono-Regular.ttf',
}

export const FONT_LABELS: Record<FontId, string> = {
  sans: 'Sans',
  'sans-bold': 'Sans Bold',
  serif: 'Serif',
  'serif-bold': 'Serif Bold',
  mono: 'Mono',
}

/** CSS font-family name used by the overlay's @font-face rules. */
export const FONT_CSS_FAMILY: Record<FontId, string> = {
  sans: 'PdfSlotSans',
  'sans-bold': 'PdfSlotSansBold',
  serif: 'PdfSlotSerif',
  'serif-bold': 'PdfSlotSerifBold',
  mono: 'PdfSlotMono',
}

export type FontBytes = Record<FontId, Uint8Array>
