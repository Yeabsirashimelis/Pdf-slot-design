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

/**
 * Whether `id` is a content hash as `hashBytes` produces it: 64 lowercase
 * hex chars. The one shape that can be recognised again on re-upload; a
 * random id (see below) and anything read from an untrusted stamp are not.
 */
export function isFileId(id: string): boolean {
  return /^[0-9a-f]{64}$/.test(id)
}

/**
 * 128 random bits as 32 lowercase hex chars, for a file (or slot) that
 * needs an id with no content to hash. Built on `crypto.getRandomValues`,
 * not `crypto.randomUUID`: the latter is exposed only in secure contexts,
 * i.e. exactly where `hashBytes` already returned null, so falling back to
 * it there would throw instead of opening the file.
 */
export function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
