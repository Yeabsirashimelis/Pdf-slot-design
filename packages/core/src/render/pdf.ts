import {
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFStream,
  PDFString,
  degrees,
  rgb,
  type PDFPage,
} from '@cantoo/pdf-lib'
// fontkit@2.0.4's ESM build has no default export; its named exports
// (`create`, notably) satisfy @cantoo/pdf-lib's structural `Fontkit`
// interface directly via a namespace import. Never `@pdf-lib/fontkit`:
// that package crashes inside `TTFSubset.encode` on save when subsetting
// (see test/metrics-characterization.test.ts).
import * as fontkit from 'fontkit'
import type { EditorDocument, Slot } from '../document/types'
import type { FontBytes, FontId } from '../fonts/registry'
import { normalizeRotation, toUnrotatedPoint } from '../geometry/rotation'
import { createFontMetrics } from '../layout/metrics'
import { layoutText, slotLayout } from '../layout/wrap'

/** Fixed so identical input yields identical bytes. */
const EPOCH = new Date(0)

/**
 * Key set on the dictionary of every content stream this tool adds to a
 * page, so a later `renderPdfIncremental` can tell its own text apart from
 * the document's original content and replace exactly that. Private keys
 * in a stream dictionary are legal PDF (ISO 32000-1 §7.3.7 says readers
 * ignore entries they don't recognise) and every viewer ignores this one.
 */
export const SLOT_STREAM_MARKER = 'PdfSlotText'

/**
 * Info-dictionary key carrying the id (content hash) of the *source* PDF an
 * export was made from. A downloaded copy has different bytes from its
 * source, so re-uploading it would not match by content; this is what
 * still lets it find its saved layout. Private Info keys are legal (ISO
 * 32000-1 §14.3.3) and ignored by viewers.
 */
export const SOURCE_STAMP_KEY = 'PdfSlotSource'

/** The source id an export was stamped with, or null for any other PDF. */
export async function readSourceStamp(bytes: Uint8Array): Promise<string | null> {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
  const info = pdf.context.lookup(pdf.context.trailerInfo.Info)
  if (!(info instanceof PDFDict)) return null
  const value = info.lookup(PDFName.of(SOURCE_STAMP_KEY))
  if (value instanceof PDFHexString || value instanceof PDFString) return value.decodeText()
  return null
}

/**
 * From scratch: the original document plus every slot, written out as a
 * whole new file. This is the render whose bytes the preview is proven
 * against (see test/invariant.test.ts).
 *
 * Idempotent on its own output: any slot text an earlier render left in
 * the source is stripped first, so rendering from a downloaded copy draws
 * the current slots once, not on top of the old fill. On a source that
 * has no marked streams (every PDF not made by this tool) the strip finds
 * nothing and the output is unchanged.
 */
export async function renderPdf(
  doc: EditorDocument, slots: Slot[], fonts: FontBytes,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(doc.source)
  // A whole-file rewrite has no history to keep: drop the stripped streams
  // from the context too, or save() would still write them as orphans.
  for (const page of pdf.getPages()) {
    for (const ref of stripSlotStreams(pdf, page)) pdf.context.delete(ref)
  }
  await drawSlots(pdf, slots, fonts)
  stampSource(pdf, doc.id)
  return finish(pdf, (p) => p.save({ useObjectStreams: false }))
}

/**
 * On top of a file this tool already produced (or the untouched source):
 * strips the text this tool drew before, draws the current slots, and
 * appends only that as an incremental update -- `previous` comes back as
 * an exact byte prefix of the result, the way "Save" (not "Export") works
 * in every PDF editor. Far cheaper than re-writing a large scan on every
 * download, and the original bytes are never rewritten.
 *
 * Equivalent to `renderPdf(source, slots)` in what is drawn (see
 * test/incremental.test.ts), not in bytes: superseded streams and font
 * subsets stay in the file as dead history, as with any incremental
 * update. Fonts are re-embedded (subset) per increment rather than
 * reusing an earlier embed, because a subset only carries the glyphs the
 * earlier text used.
 */
export async function renderPdfIncremental(
  previous: Uint8Array, slots: Slot[], fonts: FontBytes,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(previous, { forIncrementalUpdate: true })
  for (const page of pdf.getPages()) stripSlotStreams(pdf, page)
  await drawSlots(pdf, slots, fonts)
  return finish(pdf, (p) => p.save())
}

/**
 * Removes this tool's earlier content streams from a page's Contents.
 * Returns the refs it unlinked; the stream objects themselves stay in the
 * context (an incremental update keeps them as history).
 */
function stripSlotStreams(pdf: PDFDocument, page: PDFPage): PDFRef[] {
  const removed: PDFRef[] = []
  const contents = page.node.normalizedEntries().Contents
  if (!contents) return removed
  for (let i = contents.size() - 1; i >= 0; i--) {
    const entry = contents.get(i)
    const obj = pdf.context.lookup(entry)
    if (obj instanceof PDFStream && obj.dict.has(PDFName.of(SLOT_STREAM_MARKER))) {
      contents.remove(i)
      if (entry instanceof PDFRef) removed.push(entry)
    }
  }
  return removed
}

/** Marks the content stream most recently added to `page` as this tool's. */
function markLatestSlotStream(pdf: PDFDocument, page: PDFPage): void {
  const contents = page.node.normalizedEntries().Contents
  if (!contents || contents.size() === 0) return
  const obj = pdf.context.lookup(contents.get(contents.size() - 1))
  if (obj instanceof PDFStream) obj.dict.set(PDFName.of(SLOT_STREAM_MARKER), PDFBool.True)
}

function stampSource(pdf: PDFDocument, sourceId: string): void {
  // setCreationDate (in finish) would create the Info dict if missing; do it
  // here so the stamp lands in the same dict.
  pdf.setCreationDate(EPOCH)
  const info = pdf.context.lookup(pdf.context.trailerInfo.Info)
  if (info instanceof PDFDict) info.set(PDFName.of(SOURCE_STAMP_KEY), PDFHexString.fromText(sourceId))
}

async function finish(pdf: PDFDocument, save: (p: PDFDocument) => Promise<Uint8Array>): Promise<Uint8Array> {
  // Pin every source of nondeterminism so repeated renders are byte-identical.
  // No explicit `/ID` fix is needed alongside these: @cantoo/pdf-lib's
  // generateRandomFileId() (core/security/PDFSecurity.js) is only reachable
  // from convertToPDFA() and PDFSecurity's own encryption setup, neither of
  // which this function calls, so plain save() never stamps a random /ID.
  pdf.setCreationDate(EPOCH)
  pdf.setModificationDate(EPOCH)
  return save(pdf)
}

async function drawSlots(pdf: PDFDocument, slots: Slot[], fonts: FontBytes): Promise<void> {
  pdf.registerFontkit(fontkit)

  const pages = pdf.getPages()
  // Pages this call drew on: each gets exactly one new content stream
  // (pdf-lib creates it on the page's first drawText and reuses it after),
  // which is marked once all drawing is done.
  const touched = new Set<PDFPage>()
  const embedded = new Map<FontId, Awaited<ReturnType<typeof pdf.embedFont>>>()
  // Scoped to this render call only: createFontMetrics() re-parses the TTF
  // (~150-250 KB per face), so without this a document with many slots on
  // one font would pay that cost once per slot instead of once per font. No
  // cache lives longer than a single renderPdf() call -- a module-level or
  // cross-call cache would need invalidation nobody has asked for.
  const metrics = new Map<FontId, ReturnType<typeof createFontMetrics>>()

  for (const slot of slots) {
    if (slot.text === '') continue
    const page = pages[slot.page]
    if (!page) continue

    let font = embedded.get(slot.fontId)
    if (!font) {
      font = await pdf.embedFont(fonts[slot.fontId], { subset: true })
      embedded.set(slot.fontId, font)
    }

    let slotMetrics = metrics.get(slot.fontId)
    if (!slotMetrics) {
      slotMetrics = createFontMetrics(fonts[slot.fontId])
      metrics.set(slot.fontId, slotMetrics)
    }

    const lines = layoutText(slotLayout(slot, slot.text), slotMetrics)

    // Slots (and so `lines`) are in the page's *displayed* space; the
    // content stream is in its unrotated user space. Map each baseline
    // origin across and turn the text by the same angle, so it reads
    // upright once a viewer applies `/Rotate` -- see geometry/rotation.ts.
    const rotation = normalizeRotation(page.getRotation().angle)
    const unrotatedSize = page.getSize()
    for (const line of lines) {
      if (line.text === '') continue
      const origin = toUnrotatedPoint({ x: line.x, y: line.baselineY }, unrotatedSize, rotation)
      page.drawText(line.text, {
        x: origin.x,
        y: origin.y,
        rotate: degrees(rotation),
        size: slot.size,
        font,
        color: rgb(slot.color.r, slot.color.g, slot.color.b),
      })
      touched.add(page)
    }
  }

  for (const page of touched) markLatestSlotStream(pdf, page)
}
