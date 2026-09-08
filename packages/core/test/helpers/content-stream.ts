import { inflateSync } from 'node:zlib'

/**
 * Pulls the decoded text of every `stream`...`endstream` block that looks
 * like a content stream (contains `BT`/`ET`) out of a saved PDF's raw
 * bytes, inflating it first if it's Flate-compressed. Test-only tooling,
 * not a general PDF parser: good enough to inspect the handful of
 * text-showing operators these tests check for.
 *
 * Returns `null` -- never `''` -- when nothing in the file shows text. That
 * matters: this used to return `''`, which made
 * `expect(extract(...)).not.toMatch(/\bTj\b/)` pass against an empty
 * string, vacuously, and just as happily if the extractor itself had
 * broken. `null` is a sentinel the caller has to handle (TypeScript will
 * not let it flow into `.match()` or into `toMatch`'s receiver), and
 * `requireContentStreamText` below is the throwing variant for callers that
 * are asserting about text that must be there.
 *
 * A `null` return still cannot, on its own, distinguish "nothing was drawn"
 * from "this extractor stopped matching" -- a genuinely empty render
 * produces a PDF with no stream objects at all, so there is no reliable
 * structural signal to throw on. Any test asserting `toBeNull()` therefore
 * has to carry its own positive control; see render.test.ts's "empty slot
 * text draws nothing".
 */
export function extractContentStreamText(pdfBytes: Uint8Array): string | null {
  const buf = Buffer.from(pdfBytes)
  const text = buf.toString('latin1')
  const streamRe = /\d+ 0 obj\s*<<([\s\S]*?)>>\s*stream\r?\n/g
  const chunks: string[] = []

  for (const match of text.matchAll(streamRe)) {
    const dict = match[1] ?? ''
    const start = (match.index ?? 0) + match[0].length
    const end = text.indexOf('endstream', start)
    if (end === -1) continue
    const raw = buf.subarray(start, end)
    const decoded = (dict.includes('FlateDecode') ? inflateSync(raw) : raw).toString('latin1')
    if (decoded.includes('BT') && decoded.includes('ET')) chunks.push(decoded)
  }

  return chunks.length === 0 ? null : chunks.join('\n')
}

/**
 * Same, for callers that are asserting *about* drawn text and for which "no
 * text stream at all" is itself a failure. Throws rather than handing back a
 * value that would make a downstream assertion pass or crash confusingly.
 */
export function requireContentStreamText(pdfBytes: Uint8Array): string {
  const text = extractContentStreamText(pdfBytes)
  if (text === null) {
    throw new Error('Expected the saved PDF to contain a text-showing content stream; it has none.')
  }
  return text
}
