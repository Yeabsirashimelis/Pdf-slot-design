/**
 * SHA-256 of the uploaded bytes, as lowercase hex: the file's identity for
 * "re-upload the same PDF, get the same layout". `null` (rather than a
 * throw) when SubtleCrypto is missing -- it is only exposed on secure
 * origins, so a plain-http dev server on a LAN address has none -- and the
 * caller treats the file as new.
 */
export async function hashBytes(bytes: Uint8Array): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return null
  const digest = await subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
