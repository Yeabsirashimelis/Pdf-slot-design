import { inflateSync } from 'node:zlib'

/**
 * Pulls the decoded text of every `stream`...`endstream` block that looks
 * like a content stream (contains `BT`/`ET`) out of a saved PDF's raw
 * bytes, inflating it first if it's Flate-compressed. Test-only tooling,
 * not a general PDF parser: good enough to inspect the handful of
 * text-showing operators these tests check for.
 */
export function extractContentStreamText(pdfBytes: Uint8Array): string {
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

  return chunks.join('\n')
}
