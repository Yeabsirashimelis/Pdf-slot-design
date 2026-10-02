import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PDFDocument } from '@cantoo/pdf-lib'
// fontkit@2.0.4's ESM build has no default export; its named exports
// (`create`, notably) satisfy @cantoo/pdf-lib's structural `Fontkit`
// interface directly via a namespace import. fontkit ships no .d.ts of its
// own -- @types/fontkit (a devDependency of @pdf-slot/core) is what lets
// `tsc --noEmit` (npm run typecheck) actually verify that match, instead of
// silently treating this import as `any`. See
// packages/core/spike/kerning-probe.ts (deleted; ran under Task 3 and its
// R-8 follow-up) for how this was determined.
import * as fontkit from 'fontkit'
import { expect, test } from 'vitest'
import { requireContentStreamText } from './helpers/content-stream.js'

const dir = fileURLToPath(new URL('../src/fonts/files/', import.meta.url))

test('pdf-lib width measurement is stable for kerning-sensitive pairs', async () => {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const font = await doc.embedFont(readFileSync(dir + 'Inter-Regular.ttf'))

  // These pin the library's behaviour so an upgrade that changes measurement
  // is caught: pdf-lib does not apply GPOS kerning here, so they equal the
  // naive sum of each glyph's raw advance width. The numbers are the sans
  // face's own -- Inter 4.1 Regular, 2048 units/em -- and Inter does carry a
  // GPOS kern pair for `AV` (-140 units, which is 6.84pt at this size), so
  // the day pdf-lib starts honouring kerning, this is the assertion that
  // fails. `iiiii` is the control: no kern pair, so it moves only if plain
  // advance-width measurement changes.
  expect(font.widthOfTextAtSize('AV', 100)).toBeCloseTo(137.98828125, 3)
  expect(font.widthOfTextAtSize('iiiii', 100)).toBeCloseTo(121.09375, 3)
})

test('embedFont with subset:true saves without throwing', async () => {
  // Regression guard for a real crash found while characterizing this
  // library: @cantoo/pdf-lib@2.9.1 + @pdf-lib/fontkit@1.1.1 threw inside
  // TTFSubset.encode ("Cannot read properties of undefined (reading
  // 'pos')") on doc.save() whenever the embedded font used
  // { subset: true }. fontkit@2.0.4 does not have this problem, and
  // subsetting is load-bearing for the export path (Task 9 subsets on
  // every render; without it each embedded face adds ~235KB per download).
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const font = await doc.embedFont(readFileSync(dir + 'Inter-Regular.ttf'), {
    subset: true,
  })
  const page = doc.addPage([200, 200])
  page.drawText('AV', { x: 0, y: 100, size: 100, font })

  const bytes = await doc.save()

  expect(bytes.byteLength).toBeGreaterThan(0)
})

test('written content stream shows text with Tj, never a kerning TJ array', async () => {
  // Pins the *other* half of the kerning finding: not just that
  // widthOfTextAtSize measures without kerning, but that the PDF pdf-lib
  // actually writes carries none either. A future pdf-lib/fontkit upgrade
  // that started emitting `[(A) -80 (V)] TJ`-style kerning arrays would
  // silently invalidate PDF_APPLIES_KERNING = false without this test.
  // Note this pins *kerning* only. Shaping (GSUB) is a separate question
  // with the opposite answer -- pdf-lib does apply it -- and is pinned by
  // metrics-pdflib-crosscheck.test.ts instead.
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const font = await doc.embedFont(readFileSync(dir + 'Inter-Regular.ttf'), {
    subset: true,
  })
  const page = doc.addPage([200, 200])
  page.drawText('AV', { x: 0, y: 100, size: 100, font })

  // Uncompressed object streams; the content stream itself may still be
  // Flate-compressed, which requireContentStreamText() handles.
  const bytes = await doc.save({ useObjectStreams: false })
  const streamText = requireContentStreamText(bytes)

  expect(streamText).toMatch(/\bTj\b/)
  expect(streamText).not.toMatch(/\bTJ\b/)
})
