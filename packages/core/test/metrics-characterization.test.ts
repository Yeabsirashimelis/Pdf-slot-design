import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PDFDocument } from '@cantoo/pdf-lib'
// fontkit@2.0.4's ESM build has no default export; its named exports
// (`create`, notably) satisfy @cantoo/pdf-lib's structural `Fontkit`
// interface directly via a namespace import. See
// packages/core/spike/kerning-probe.ts (deleted; ran under Task 3 and its
// R-8 follow-up) for how this was determined.
import * as fontkit from 'fontkit'
import { expect, test } from 'vitest'

const dir = fileURLToPath(new URL('../src/fonts/files/', import.meta.url))

test('pdf-lib width measurement is stable for kerning-sensitive pairs', async () => {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const font = await doc.embedFont(readFileSync(dir + 'PT_Sans-Web-Regular.ttf'))

  // Values printed by packages/core/spike/kerning-probe.ts (deleted after
  // this task). They pin the library's behaviour so an upgrade that changes
  // measurement is caught: pdf-lib does not apply GPOS kerning here, so
  // these equal the naive sum of each glyph's raw advance width. Identical
  // under both @pdf-lib/fontkit@1.1.1 and fontkit@2.0.4.
  expect(font.widthOfTextAtSize('AV', 100)).toBeCloseTo(115.3, 3)
  expect(font.widthOfTextAtSize('iiiii', 100)).toBeCloseTo(134.0, 3)
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
  const font = await doc.embedFont(readFileSync(dir + 'PT_Sans-Web-Regular.ttf'), {
    subset: true,
  })
  const page = doc.addPage([200, 200])
  page.drawText('AV', { x: 0, y: 100, size: 100, font })

  const bytes = await doc.save()

  expect(bytes.byteLength).toBeGreaterThan(0)
})
