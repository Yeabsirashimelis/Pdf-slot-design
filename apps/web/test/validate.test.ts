import { describe, expect, it } from 'vitest'
import { MAX_BYTES, validateFile } from '../src/features/upload/validate'

function fileOfSize(bytes: number, name: string, type: string): File {
  return new File([new Uint8Array(bytes)], name, { type })
}

describe('validateFile', () => {
  it('accepts a PDF at exactly the size limit', () => {
    const file = fileOfSize(MAX_BYTES, 'doc.pdf', 'application/pdf')
    expect(validateFile(file)).toBeNull()
  })

  it('rejects a file one byte over the size limit, before any parsing', () => {
    const file = fileOfSize(MAX_BYTES + 1, 'doc.pdf', 'application/pdf')
    expect(validateFile(file)).toBe(
      'That file is larger than 100 MB and would exhaust the browser tab.',
    )
  })

  it('accepts a PDF by declared MIME type even with a mismatched extension', () => {
    const file = fileOfSize(10, 'scan', 'application/pdf')
    expect(validateFile(file)).toBeNull()
  })

  it('accepts a PDF by .pdf extension even when the browser reports no MIME type', () => {
    const file = fileOfSize(10, 'contract.PDF', '')
    expect(validateFile(file)).toBeNull()
  })

  it.each(['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'])(
    'accepts %s images',
    (type) => {
      const file = fileOfSize(10, 'photo', type)
      expect(validateFile(file)).toBeNull()
    },
  )

  it('rejects an unsupported type with a message naming the supported formats', () => {
    const file = fileOfSize(10, 'clip.mp4', 'video/mp4')
    expect(validateFile(file)).toBe('Upload a PDF, or a PNG, JPEG, WebP or HEIC image.')
  })

  it('accepts a text file renamed to .pdf -- the extension alone is enough for this metadata check', () => {
    // Extension alone is one of the two accepted signals (see the .pdf-by-
    // extension case above); a renamed .txt still passes this metadata
    // check by design -- validateFile only rules out what it can tell from
    // File metadata. The actual "not a readable PDF" rejection for content
    // that lies about its extension happens downstream, at normalizePdf.
    const file = fileOfSize(10, 'notes.pdf', 'text/plain')
    expect(validateFile(file)).toBeNull()
  })

  it('size check takes precedence over an unsupported type', () => {
    const file = fileOfSize(MAX_BYTES + 1, 'clip.mp4', 'video/mp4')
    expect(validateFile(file)).toBe(
      'That file is larger than 100 MB and would exhaust the browser tab.',
    )
  })
})
