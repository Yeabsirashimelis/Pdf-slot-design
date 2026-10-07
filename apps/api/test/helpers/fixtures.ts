import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib'
import { FONT_FILES, FONT_IDS, type FontBytes } from '@pdf-slot/core'
import type { Hono } from 'hono'
import type { AppEnv } from '../../src/app.js'

export const fontsDir = fileURLToPath(new URL('../../../../packages/core/src/fonts/files/', import.meta.url))

export function coreFonts(): FontBytes {
  return Object.fromEntries(FONT_IDS.map((id) => [id, new Uint8Array(readFileSync(fontsDir + FONT_FILES[id]))])) as FontBytes
}

export async function twoPagePdf(): Promise<Uint8Array> {
  const d = await PDFDocument.create()
  const f = await d.embedFont(StandardFonts.Helvetica)
  for (const t of ['Page one', 'Page two']) d.addPage([612, 792]).drawText(t, { x: 60, y: 720, size: 24, font: f })
  return d.save()
}

export const FILE_ID = 'f'.repeat(64)
export const slot = (over: Record<string, unknown> = {}) => ({
  id: 's1', name: 'Name', order: 0, page: 0, x: 50, y: 700, width: 300,
  fontId: 'sans', size: 14, color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2, ...over,
})

export async function putTestFile(app: Hono<AppEnv>, fileId = FILE_ID, bytes?: Uint8Array) {
  const form = new FormData()
  form.set('meta', JSON.stringify({ name: 'form.pdf', pages: [{ width: 612, height: 792 }, { width: 612, height: 792 }], createdAt: '2026-09-19T00:00:00.000Z' }))
  form.set('source', new Blob([Uint8Array.from(bytes ?? (await twoPagePdf()))], { type: 'application/pdf' }), 'form.pdf')
  return app.request(`/files/${fileId}`, { method: 'PUT', body: form })
}
