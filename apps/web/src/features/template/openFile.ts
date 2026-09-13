import {
  normalizePdf, readSourceStamp,
  type EditorDocument, type FileId, type TemplateLayout, type TemplateValues,
} from '@pdf-slot/core'
import { hashBytes, isFileId, randomId } from '@/lib/files/fileHash'
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
 *
 * A stamped upload is a filled copy: its bytes already carry the text of
 * some earlier export. When the original is still stored, that is what
 * opens, so the slots are drawn over the blank page and not over the
 * previous fill. (renderPdf also strips its own earlier streams, so even
 * a stamped copy whose original is gone will not double the text.)
 */
export async function openFile(pdfBytes: Uint8Array, name: string, store: TemplateStore): Promise<OpenedFile> {
  // Anything can write our Info key; only a value shaped like a content
  // hash is taken as one, the rest falls through to hashing the bytes.
  const stamp = await readSourceStamp(pdfBytes).then((s) => (s !== null && isFileId(s) ? s : null), () => null)
  const fileId = stamp ?? (await hashBytes(pdfBytes)) ?? randomId()
  const [layout, values, existing] = await Promise.all([
    store.getLayout(fileId), store.getValues(fileId), store.getFile(fileId),
  ])
  const source = stamp && existing ? existing.source : pdfBytes
  const doc = await normalizePdf(source, fileId)
  if (!existing) {
    await store.putFile({ fileId, name, source, pages: doc.pages, createdAt: new Date().toISOString() })
  }
  return { doc, fileId, layout, values, step: layout && layout.slots.length > 0 ? 'write' : 'layout' }
}
