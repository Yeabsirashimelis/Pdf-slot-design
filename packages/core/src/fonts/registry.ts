export type FontId = 'sans' | 'sans-bold' | 'serif' | 'serif-bold' | 'mono'

export const FONT_IDS: readonly FontId[] = [
  'sans', 'sans-bold', 'serif', 'serif-bold', 'mono',
] as const

/**
 * The TTF behind each id, in ./files -- and, byte for byte, in
 * apps/web/public/fonts, where the browser fetches the very same file to
 * register as a CSS face. The id is the stable thing: it is what a saved
 * layout stores, so changing which typeface an id maps to re-flows old
 * documents but never breaks them.
 *
 * Every face here must be a *static* TTF. A variable font would carry an
 * `fvar` table, which pdf-lib/fontkit cannot be relied on to embed, and the
 * bold request would silently come out at the default weight.
 * test/fonts.test.ts enforces it.
 *
 * Provenance:
 *  - Inter 4.1, static instances from `extras/ttf/` of the official release
 *    (github.com/rsms/inter) -- SIL OFL 1.1, ./Inter-LICENSE.txt.
 *  - PT Serif, IBM Plex Mono -- SIL OFL 1.1, via github.com/google/fonts.
 */
export const FONT_FILES: Record<FontId, string> = {
  sans: 'Inter-Regular.ttf',
  'sans-bold': 'Inter-Bold.ttf',
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

/**
 * CSS font-family name used by the overlay's @font-face rules.
 *
 * Deliberately private names, never the typeface's real one. `Inter` is a
 * font a reader may well have installed locally, and a family called `Inter`
 * would let the browser satisfy the overlay from that copy -- a different
 * version, different metrics -- while the export used the bytes in ./files.
 * The preview would drift from the download with nothing on screen to say
 * so. A name no system font can claim makes the registered bytes the only
 * thing that can match (see apps/web/src/lib/fonts/loadFonts.ts).
 */
export const FONT_CSS_FAMILY: Record<FontId, string> = {
  sans: 'PdfSlotSans',
  'sans-bold': 'PdfSlotSansBold',
  serif: 'PdfSlotSerif',
  'serif-bold': 'PdfSlotSerifBold',
  mono: 'PdfSlotMono',
}

export type FontBytes = Record<FontId, Uint8Array>
