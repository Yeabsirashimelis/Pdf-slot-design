import { PDFDocument } from '@cantoo/pdf-lib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderPdf, FONT_IDS, FONT_FILES, type FontBytes, type TemplateLayout } from '@pdf-slot/core'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { TemplateStore } from '@/lib/persistence/templateStore'
import { openFile } from '@/features/template/openFile'

function memoryStore(): TemplateStore & { layouts: Map<string, TemplateLayout>; files: string[] } {
  const layouts = new Map<string, TemplateLayout>()
  const files: string[] = []
  return {
    layouts, files,
    getFile: async () => null,
    putFile: async (f) => { files.push(f.fileId) },
    getLayout: async (id) => layouts.get(id) ?? null,
    putLayout: async (l) => { layouts.set(l.fileId, l) },
    getValues: async () => null,
    putValues: async () => {},
  }
}

async function blankPdf(): Promise<Uint8Array> {
  const d = await PDFDocument.create()
  d.addPage([612, 792])
  return d.save()
}

describe('openFile', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('an unknown PDF lands in the layout step, is stored, and its id is the content hash', async () => {
    const store = memoryStore()
    const bytes = await blankPdf()
    const opened = await openFile(bytes, 'form.pdf', store)
    expect(opened.step).toBe('layout')
    expect(opened.layout).toBeNull()
    expect(opened.fileId).toMatch(/^[0-9a-f]{64}$/)
    expect(opened.doc.id).toBe(opened.fileId)
    expect(store.files).toEqual([opened.fileId])
  })

  it('the same bytes again land in the write step with the saved layout', async () => {
    const store = memoryStore()
    const bytes = await blankPdf()
    const first = await openFile(bytes, 'form.pdf', store)
    store.layouts.set(first.fileId, { fileId: first.fileId, slots: [], updatedAt: 't' })
    const again = await openFile(bytes.slice(), 'renamed.pdf', store)
    expect(again.fileId).toBe(first.fileId)
    expect(again.step).toBe('write')
    expect(again.layout).not.toBeNull()
  })

  it('a copy this tool exported is recognised by its stamp, not its (different) bytes', async () => {
    const store = memoryStore()
    const bytes = await blankPdf()
    const first = await openFile(bytes, 'form.pdf', store)
    store.layouts.set(first.fileId, { fileId: first.fileId, slots: [], updatedAt: 't' })
    const fonts = Object.fromEntries(
      FONT_IDS.map((id) => [id, new Uint8Array(readFileSync(path.resolve(__dirname, '../public/fonts', FONT_FILES[id])))]),
    ) as FontBytes
    const exported = await renderPdf(first.doc, [], fonts)
    const reopened = await openFile(exported, 'edited.pdf', store)
    expect(reopened.fileId).toBe(first.fileId)
    expect(reopened.step).toBe('write')
  })

  it('without SubtleCrypto the file still opens (as new, with a random id)', async () => {
    vi.stubGlobal('crypto', { ...globalThis.crypto, subtle: undefined, randomUUID: () => 'rand-1' })
    const opened = await openFile(await blankPdf(), 'form.pdf', memoryStore())
    expect(opened.fileId).toBe('rand-1')
    expect(opened.step).toBe('layout')
  })
})
