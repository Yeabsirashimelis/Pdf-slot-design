export const MAX_BYTES = 100 * 1024 * 1024

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif']

/**
 * Checked before any parsing happens. Every rejectable condition detectable
 * from `File` metadata alone (size, declared type, extension) is caught
 * here so it never surfaces mid-edit -- only content-level failures
 * (malformed or encrypted PDF bytes, an undecodable image) fall through to
 * normalizePdf/decodeImage further down the upload pipeline.
 *
 * Returns a human-readable reason to reject, or null when the file is usable.
 */
export function validateFile(file: File): string | null {
  if (file.size > MAX_BYTES) {
    return 'That file is larger than 100 MB and would exhaust the browser tab.'
  }
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) return null
  if (IMAGE_TYPES.includes(file.type)) return null
  return 'Upload a PDF, or a PNG, JPEG, WebP or HEIC image.'
}
