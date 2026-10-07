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
 * Whether pdf-lib's output honours GPOS **kerning** — and nothing else.
 *
 * Kerning and shaping are two distinct things, and pdf-lib treats them
 * differently. Conflating them is exactly the bug this constant's previous
 * name (`KERNING_APPLIED`) caused, so the distinction is recorded here:
 *
 * - **Kerning (GPOS positioning)** — pdf-lib ignores it. `encodeText` and
 *   `widthOfTextAtSize` both read `font.layout(text).glyphs[].advanceWidth`
 *   and never touch `positions[].xAdvance`, which is where fontkit puts the
 *   kern adjustment. The written content stream confirms it: a plain `Tj`
 *   on one glyph-code string, never a `TJ` array with numeric offsets (see
 *   metrics-characterization.test.ts). So `false`, and the overlay must set
 *   `font-kerning: none` (Task 15) to match.
 * - **Shaping (GSUB substitution)** — pdf-lib *does* apply it, because
 *   `font.layout()` runs the default feature set. Which features that
 *   reaches differs by face, and every bundled face has some:
 *   PT Serif ships `liga`, so `office` draws as `of·fi·ce` with an `fi`
 *   ligature; Inter (the sans face) ships no `liga` at all but does ship
 *   `calt`, which collapses `->` into a single `arrowright` glyph. Either
 *   way the drawn string is genuinely narrower than the sum of its
 *   per-character advances. `widthOfText` below therefore measures via
 *   `layout()` too, and the overlay must NOT turn substitution off — not
 *   `font-variant-ligatures: none`, and not `font-feature-settings:
 *   "calt" 0` — because doing so makes the browser deliberately disagree
 *   with the exporter. Both are on by default in CSS, so the overlay gets
 *   this right by saying nothing; the trap is *adding* a reset.
 *
 * This constant governs only the first bullet. Measurement is not
 * parameterised on it: shaping is always applied, kerning never is, because
 * that is unconditionally what pdf-lib does — see
 * metrics-pdflib-crosscheck.test.ts, which asserts width agreement directly
 * against `widthOfTextAtSize` over ligature-forming and kerning-sensitive
 * words alike.
 */
export const PDF_APPLIES_KERNING = false

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

/**
 * How many measured strings one face remembers (see `createFontMetrics`).
 * Large enough that a page of slots re-wrapping on every keystroke always
 * hits, small enough to stay a rounding error against the parsed font.
 */
const WIDTH_CACHE_LIMIT = 4096

export function createFontMetrics(ttf: Uint8Array): FontMetrics {
  // No Buffer.from() here: this must run in the browser (see the module
  // augmentation above), where the Node `Buffer` global does not exist.
  const font = firstFont(fontkit.create(ttf))

  const scale = (units: number, size: number) => (units / font.unitsPerEm) * size

  /**
   * Advance-width sums already measured, keyed by the string, per face.
   *
   * Shaping is not cheap, and how expensive depends on the face: Inter's
   * `calt` alone carries 61 contextual subtables, and `font.layout()` on a
   * 56-character line costs ~1ms against PT Serif's ~0.15ms. `breakParagraph`
   * measures a growing prefix once per word and then each finished line
   * again, every slot, on every keystroke, so the same strings are measured
   * over and over -- without this, moving the sans face to Inter made the
   * editor's re-wrap about seven times more expensive.
   *
   * What is cached is advance *units*, never points: the sum is an integer
   * that does not depend on the font size, and `scale()` is applied afterwards
   * exactly as it was before. A hit therefore returns the identical number,
   * bit for bit, to what measuring again would -- which is what makes this an
   * optimisation and not a risk to preview-equals-download.
   *
   * Bounded, and dropped whole rather than evicted one by one: the API holds
   * one FontMetrics per face for the life of the process and streams
   * unbounded distinct text through it during a bulk job. Dropping is free of
   * consequence precisely because the function is pure -- the cost of a miss
   * is one measurement.
   */
  const widthUnits = new Map<string, number>()

  return {
    widthOfText(text, size) {
      if (text.length === 0) return 0
      let units = widthUnits.get(text)
      if (units === undefined) {
        // `layout()`, not `glyphsForString()`: this must reproduce pdf-lib's
        // own arithmetic exactly, and pdf-lib measures (widthOfTextAtSize) and
        // encodes (CustomFontEmbedder.encodeText) through `font.layout(text)`.
        // That applies GSUB shaping — `office` becomes 5 glyphs in PT Serif,
        // `a->b` 3 in Inter — while still excluding GPOS kerning, which lives
        // in `positions[].xAdvance` and is never read here. See
        // PDF_APPLIES_KERNING's comment above.
        const glyphs = font.layout(text).glyphs
        units = 0
        for (const glyph of glyphs) units += glyph.advanceWidth
        if (widthUnits.size >= WIDTH_CACHE_LIMIT) widthUnits.clear()
        widthUnits.set(text, units)
      }
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
