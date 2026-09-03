import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PDFDocument } from '@cantoo/pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { expect, test } from 'vitest'

const dir = fileURLToPath(new URL('../src/fonts/files/', import.meta.url))

test('pdf-lib width measurement is stable for kerning-sensitive pairs', async () => {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const font = await doc.embedFont(readFileSync(dir + 'PT_Sans-Web-Regular.ttf'))

  // Values printed by packages/core/spike/kerning-probe.ts (deleted after
  // this task). They pin the library's behaviour so an upgrade that changes
  // measurement is caught: pdf-lib does not apply GPOS kerning here, so
  // these equal the naive sum of each glyph's raw advance width.
  expect(font.widthOfTextAtSize('AV', 100)).toBeCloseTo(115.3, 3)
  expect(font.widthOfTextAtSize('iiiii', 100)).toBeCloseTo(134.0, 3)
})
