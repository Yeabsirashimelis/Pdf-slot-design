// fontkit@2.0.4's ESM build has no default export; its named exports
// (`create`, notably) are what we use here. fontkit ships no .d.ts of its
// own -- @types/fontkit (a devDependency of @pdf-slot/core) is what lets
// `tsc --noEmit` (npm run typecheck) actually verify this usage, instead of
// silently treating the import as `any`. See
// packages/core/test/metrics-characterization.test.ts for the measured
// kerning finding this module encodes.
import * as fontkit from 'fontkit'
import type { Font, FontCollection } from 'fontkit'
import type { FontId } from '../fonts/registry'

// @types/fontkit declares create()'s first parameter as Node's `Buffer`.
// That's stricter than fontkit's actual contract: fontkit@2.0.4's
// implementation (node_modules/fontkit/src/base.js) does
// `new DecodeStream(buffer)`, and `restructure`'s DecodeStream only reads
// bytes off whatever Uint8Array-like it's given -- it never calls a
// Buffer-specific method (write/toJSON/equals/compare/...). fontkit also
// ships separate `node` and browser/`module` entry points specifically so
// it runs without a real Node `Buffer` global, which this package's callers
// require: createFontMetrics() below is called from browser-only code
// (Task 15's SlotLines.tsx, in its render path), where `Buffer` does not
// exist and Next.js does not polyfill it. This overload tells the compiler
// the truth -- create() also accepts a plain Uint8Array -- instead of
// forcing a `Buffer.from()` conversion that would crash there, or an
// `as any`/`as unknown as Buffer` cast that would silence the checker
// instead of correcting it.
declare module 'fontkit' {
  export function create(buffer: Uint8Array, postscriptName?: string): Font | FontCollection
}

/**
 * Whether pdf-lib's output honours GPOS kerning. Determined empirically in
 * Task 3 (see metrics-characterization.test.ts): the content stream pdf-lib
 * writes uses plain `Tj` glyph-code strings, never a `TJ` array with
 * kerning adjustments, and widthOfTextAtSize() measures without kerning
 * too. The two agree, so we measure the same way here.
 *
 * The overlay's CSS must match this: when false it sets `font-kerning: none`
 * (Task 15) so the browser preview agrees with the exported file.
 */
export const KERNING_APPLIED = false

export type FontMetrics = {
  widthOfText(text: string, size: number): number
  ascender(size: number): number
  descender(size: number): number
  /** Characters in `text` this face cannot encode, deduped, in first-seen order. */
  unsupportedCharacters(text: string): string[]
}

type ParsedFont = ReturnType<typeof fontkit.create>

/** fontkit.create() returns a single Font for TTF/WOFF/WOFF2, or a
 * FontCollection (TTC/DFont) with a `fonts` array. Every face this project
 * bundles is a plain static TTF, so this narrows to the first font in a
 * collection only as a defensive fallback -- it is never expected to run. */
function firstFont(parsed: ParsedFont): Extract<ParsedFont, { unitsPerEm: number }> {
  if ('fonts' in parsed) {
    const first = parsed.fonts[0]
    if (!first) throw new Error('Font collection contained no fonts')
    return first
  }
  return parsed
}

export function createFontMetrics(ttf: Uint8Array): FontMetrics {
  // No Buffer.from() here: this must run in the browser (see the module
  // augmentation above), where the Node `Buffer` global does not exist.
  const font = firstFont(fontkit.create(ttf))

  const scale = (units: number, size: number) => (units / font.unitsPerEm) * size

  return {
    widthOfText(text, size) {
      if (text.length === 0) return 0
      // KERNING_APPLIED drives which glyph list gets summed, so a future
      // re-measurement that flips the constant changes behaviour here too
      // instead of silently going stale.
      const glyphs = KERNING_APPLIED ? font.layout(text).glyphs : font.glyphsForString(text)
      let units = 0
      for (const glyph of glyphs) units += glyph.advanceWidth
      return scale(units, size)
    },
    ascender(size) {
      return scale(font.ascent, size)
    },
    descender(size) {
      return scale(font.descent, size)
    },
    unsupportedCharacters(text) {
      const seen = new Set<string>()
      const result: string[] = []
      for (const char of text) {
        if (seen.has(char)) continue
        const glyph = font.glyphForCodePoint(char.codePointAt(0) ?? 0)
        if (glyph.id === 0) {
          seen.add(char)
          result.push(char)
        }
      }
      return result
    },
  }
}

export type MetricsProvider = (fontId: FontId) => FontMetrics
