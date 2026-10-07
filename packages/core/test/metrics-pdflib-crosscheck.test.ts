import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PDFDocument } from '@cantoo/pdf-lib'
// fontkit@2.0.4's ESM build has no default export; its named exports satisfy
// @cantoo/pdf-lib's structural `Fontkit` interface via a namespace import.
import * as fontkit from 'fontkit'
import { describe, expect, test } from 'vitest'
import { FONT_FILES, FONT_IDS, type FontId } from '../src/fonts/registry.js'
import { createFontMetrics } from '../src/layout/metrics.js'

const dir = fileURLToPath(new URL('../src/fonts/files/', import.meta.url))

/**
 * The one assertion that upholds the guarantee at the metric level: the
 * width the layout engine measures a string at MUST equal the width pdf-lib
 * will draw it at. Line breaks, and the x origin of every centre/right
 * aligned line, are computed from our number; the page is painted from
 * pdf-lib's. If they disagree, the export drifts from the preview.
 *
 * The word list deliberately mixes four cases:
 *  - ligature-forming words (`office`, `affluent`, `fluffy`, `waffle`) --
 *    PT Serif ships a `liga` GSUB feature, and pdf-lib's
 *    `widthOfTextAtSize`/`encodeText` both go through `font.layout()`, which
 *    applies default features including `liga`. Measuring with
 *    `glyphsForString` (no shaping) is off by the ligature's saving.
 *  - contextual-alternate strings (`a->b`, `x-->y`) -- this is the shaping
 *    the *sans* face actually does. Inter ships no `liga` at all, so the
 *    words above exercise nothing in it; what it ships is a `calt` that
 *    rewrites arrow-like runs into single glyphs. `->` collapses to one
 *    `arrowright` and `-->` to one `uni27F6`, making those strings 7-9%
 *    narrower than the sum of their characters' advances. `calt` is on by
 *    default in fontkit's shaper *and* in every browser
 *    (`font-variant-ligatures: contextual` is the CSS initial value), so all
 *    three parties -- the layout engine, pdf-lib and the overlay -- substitute
 *    alike. Without these samples the sans face's shaping would be untested,
 *    exactly as PT Sans's ligatures once were.
 *  - kerning-sensitive pairs (`AV`, `To`, `WA`, `Yo`, `r.`) -- Inter kerns
 *    all five, and pdf-lib genuinely ignores GPOS kerning (it sums
 *    `glyphs[].advanceWidth`, never `positions[].xAdvance`), so these must
 *    still agree.
 *  - plain strings, as a control.
 *
 * The original characterization (spec §7, ruling R-8) used only the last
 * two groups, which is why the shaping half went unnoticed: every sample
 * was ligature-free, so the delta was 0.00 every time.
 */
const WORDS = [
  'office',
  'affluent',
  'fluffy',
  'waffle',
  'flow',
  'difficult',
  'a->b',
  'x-->y',
  'AV',
  'To',
  'WA',
  'Yo',
  'r.',
  'iiiii',
  'Hamburgefonstiv',
  'Acme Construction Company Ltd',
  'plain',
  'Привет мир',
]

const SIZES = [8, 12, 100]

async function embed(fontId: FontId) {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  return doc.embedFont(readFileSync(dir + FONT_FILES[fontId]), { subset: true })
}

describe('createFontMetrics agrees with pdf-lib on advance widths', () => {
  for (const fontId of FONT_IDS) {
    test(`${fontId}: widthOfText === pdf-lib widthOfTextAtSize`, async () => {
      const pdfFont = await embed(fontId)
      const metrics = createFontMetrics(readFileSync(dir + FONT_FILES[fontId]))

      for (const word of WORDS) {
        for (const size of SIZES) {
          expect(
            metrics.widthOfText(word, size),
            `${fontId} ${JSON.stringify(word)} @ ${size}`,
          ).toBeCloseTo(pdfFont.widthOfTextAtSize(word, size), 6)
        }
      }
    })
  }
})
