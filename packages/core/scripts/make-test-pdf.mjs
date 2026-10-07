// A plain one-page PDF to test against, built on demand so checks never
// depend on fetching a fixture over a network.
//
// Usage: node scripts/make-test-pdf.mjs <out.pdf>
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib'
import { writeFileSync } from 'node:fs'

const out = process.argv[2]
if (!out) {
  console.error('usage: make-test-pdf.mjs <out.pdf>')
  process.exit(1)
}

const doc = await PDFDocument.create()
const font = await doc.embedFont(StandardFonts.Helvetica)
doc.addPage([612, 792]).drawText('Test form', { x: 60, y: 740, size: 18, font })
writeFileSync(out, await doc.save())
console.log('wrote', out)
