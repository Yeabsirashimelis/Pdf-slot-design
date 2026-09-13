import { PDFDocument, PDFDict, PDFName, PDFString } from '@cantoo/pdf-lib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderPdf, FONT_IDS, FONT_FILES, type FontBytes, type StoredFile, type TemplateLayout } from '@pdf-slot/core'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { TemplateStore } from '@/lib/persistence/templateStore'
import { openFile } from '@/features/template/openFile'

function memoryStore(): TemplateStore & { layouts: Map<string, TemplateLayout>; files: string[]; stored: Map<string, StoredFile> } {
  const layouts = new Map<string, TemplateLayout>()
  const files: string[] = []
  const stored = new Map<string, StoredFile>()
  return {
    layouts, files, stored,
    getFile: async (id) => stored.get(id) ?? null,
    putFile: async (f) => { files.push(f.fileId); stored.set(f.fileId, f) },
    getLayout: async (id) => layouts.get(id) ?? null,
    putLayout: async (l) => { layouts.set(l.fileId, l) },
    getValues: async () => null,
    putValues: async () => {},
  }
}

/** A layout with something in it: only such a layout makes a file "known". */
function oneSlotLayout(fileId: string): TemplateLayout {
  return {
    fileId, updatedAt: 't',
    slots: [{ id: 's1', name: 'CO#', order: 0, page: 0, x: 50, y: 700, width: 200, fontId: 'sans', size: 14, color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2 }],
  }
}

const fonts = Object.fromEntries(
  FONT_IDS.map((id) => [id, new Uint8Array(readFileSync(path.resolve(__dirname, '../public/fonts', FONT_FILES[id])))]),
) as FontBytes

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
    store.layouts.set(first.fileId, oneSlotLayout(first.fileId))
    const again = await openFile(bytes.slice(), 'renamed.pdf', store)
    expect(again.fileId).toBe(first.fileId)
    expect(again.step).toBe('write')
    expect(again.layout).not.toBeNull()
  })

  it('a saved layout with no slots is not a known file: it lands in the layout step', async () => {
    // Nothing to write into, so step 2 would be a locked page with an empty
    // form. (A layout like this could only come from a safety-net write that
    // never should have happened; see useDebouncedWrite.)
    const store = memoryStore()
    const bytes = await blankPdf()
    const first = await openFile(bytes, 'form.pdf', store)
    store.layouts.set(first.fileId, { fileId: first.fileId, slots: [], updatedAt: 't' })
    const again = await openFile(bytes.slice(), 'form.pdf', store)
    expect(again.step).toBe('layout')
  })

  it('a copy this tool exported is recognised by its stamp, not its (different) bytes', async () => {
    const store = memoryStore()
    const bytes = await blankPdf()
    const first = await openFile(bytes, 'form.pdf', store)
    store.layouts.set(first.fileId, oneSlotLayout(first.fileId))
    const exported = await renderPdf(first.doc, [], fonts)
    const reopened = await openFile(exported, 'edited.pdf', store)
    expect(reopened.fileId).toBe(first.fileId)
    expect(reopened.step).toBe('write')
  })

  it('a re-uploaded export opens the stored original, not the filled copy, so its text is not drawn twice', async () => {
    const store = memoryStore()
    const bytes = await blankPdf()
    const first = await openFile(bytes, 'form.pdf', store)
    const layout = oneSlotLayout(first.fileId)
    store.layouts.set(first.fileId, layout)
    const exported = await renderPdf(first.doc, [{ ...layout.slots[0]!, text: 'Filled' }], fonts)
    const reopened = await openFile(exported, 'edited.pdf', store)
    expect(reopened.fileId).toBe(first.fileId)
    expect(Array.from(reopened.doc.source)).toEqual(Array.from(bytes))
    expect(Array.from(reopened.doc.source)).not.toEqual(Array.from(exported))
    // The record already existed; it is not rewritten with the export.
    expect(store.files).toEqual([first.fileId])
  })

  it('a stamp that is not a content hash is ignored: the file is identified by its bytes', async () => {
    // Anything can write our Info key. A stamp that is not 64 hex chars
    // would otherwise become the file's identity verbatim (and be
    // mistaken for "no SubtleCrypto" by the page).
    const pdf = await PDFDocument.create()
    pdf.addPage([612, 792])
    pdf.setCreationDate(new Date(0))
    const info = pdf.context.lookup(pdf.context.trailerInfo.Info)
    if (!(info instanceof PDFDict)) throw new Error('no Info dict')
    info.set(PDFName.of('PdfSlotSource'), PDFString.of('not-a-hash'))
    const bytes = await pdf.save()
    const opened = await openFile(bytes, 'tampered.pdf', memoryStore())
    expect(opened.fileId).not.toBe('not-a-hash')
    expect(opened.fileId).toMatch(/^[0-9a-f]{64}$/)
    expect(opened.step).toBe('layout')
  })

  it('without SubtleCrypto the file still opens (as new, with a random id)', async () => {
    // What an insecure origin exposes: getRandomValues, and nothing else --
    // no `subtle`, and no `randomUUID` either, so the fallback must not lean
    // on it. (Spreading a Crypto instance would copy nothing: its methods
    // live on the prototype.)
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) })
    const opened = await openFile(await blankPdf(), 'form.pdf', memoryStore())
    expect(opened.fileId).toMatch(/^[0-9a-f]{32}$/)
    expect(opened.step).toBe('layout')
  })
})
