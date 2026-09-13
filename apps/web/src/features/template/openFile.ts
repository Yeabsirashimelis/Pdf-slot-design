import {
  normalizePdf, readSourceStamp,
  type EditorDocument, type FileId, type TemplateLayout, type TemplateValues,
} from '@pdf-slot/core'
import { hashBytes } from '@/lib/files/fileHash'
import type { Step, TemplateStore } from '@/lib/persistence/templateStore'

export type OpenedFile = {
  doc: EditorDocument
  fileId: FileId
  layout: TemplateLayout | null
  values: TemplateValues | null
  step: Step
}

/**
 * Everything that happens between "here are PDF bytes" and "show the
 * editor": work out which file this is, fetch what we remember about it,
 * and decide which step to land in (spec: known file -> write, new file
 * -> layout). "Known" means a saved layout with at least one slot: a
 * layout with no slots has nothing to write into, so the file opens in
 * the layout step like a new one.
 *
 * Identity, in order: the stamp an earlier export of ours left in the Info
 * dictionary (a downloaded copy has different bytes from its source), then
 * the content hash, then -- only when SubtleCrypto is missing, i.e. an
 * insecure origin -- a random id, which means the file cannot be
 * recognised next time.
 */
export async function openFile(pdfBytes: Uint8Array, name: string, store: TemplateStore): Promise<OpenedFile> {
  const fileId = (await readSourceStamp(pdfBytes).catch(() => null)) ?? (await hashBytes(pdfBytes)) ?? crypto.randomUUID()
  const doc = await normalizePdf(pdfBytes, fileId)
  const [layout, values, existing] = await Promise.all([
    store.getLayout(fileId), store.getValues(fileId), store.getFile(fileId),
  ])
  if (!existing) {
    await store.putFile({ fileId, name, source: pdfBytes, pages: doc.pages, createdAt: new Date().toISOString() })
  }
  return { doc, fileId, layout, values, step: layout && layout.slots.length > 0 ? 'write' : 'layout' }
}
