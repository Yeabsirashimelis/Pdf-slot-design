import {
  normalizePdf, readSourceStamp, tableFromStored,
  type EditorDocument, type FileId, type TemplateLayout, type TemplateValues,
} from '@pdf-slot/core'
import { hashBytes, isFileId, randomId } from '@/lib/files/fileHash'
import type { TemplateStore } from '@/lib/persistence/templateStore'

export type OpenedFile = {
  doc: EditorDocument
  /** The name the file was uploaded (or stored) under. */
  name: string
  fileId: FileId
  layout: TemplateLayout | null
  values: TemplateValues | null
}

/**
 * Everything that happens between "here are PDF bytes" and "show the
 * editor": work out which file this is and fetch what we remember about
 * it -- its layout (the slots) and its values (what was written into
 * them), so a known file opens with both back in place.
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
  const [stored, values, existing] = await Promise.all([
    store.getLayout(fileId), store.getValues(fileId), store.getFile(fileId),
  ])
  // A layout saved before rows carried their own heights is read into the
  // shape the editor works in, once, here at the boundary -- so nothing
  // downstream has to know there ever was another shape.
  const layout = stored && { ...stored, tables: stored.tables?.map(tableFromStored) }
  const source = stamp && existing ? existing.source : pdfBytes
  const doc = await normalizePdf(source, fileId)
  if (!existing) {
    await store.putFile({ fileId, name, source, pages: doc.pages, createdAt: new Date().toISOString() })
  }
  return { doc, name: existing?.name ?? name, fileId, layout, values }
}
