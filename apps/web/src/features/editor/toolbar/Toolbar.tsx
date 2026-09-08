'use client'

import { Button } from '@/components/ui/button'

/**
 * Minimal toolbar for Task 16: only a download button, just enough to give
 * the commit -> render -> download pipeline a UI surface to exercise end to
 * end. Font/color/alignment controls are Task 17's.
 */
export function Toolbar({
  bytes,
  isRendering,
}: {
  bytes: Uint8Array | null
  isRendering: boolean
}) {
  const handleDownload = () => {
    // Must never call renderPdf here: `bytes` is already the real output
    // file produced on the last commit, and downloading anything other than
    // exactly those bytes -- e.g. a fresh render -- would produce a second
    // artifact that merely ought to match the one on screen instead of
    // being it.
    if (!bytes) return
    // renderPdf() (via @cantoo/pdf-lib's pdf.save()) always returns a
    // Uint8Array backed by a fresh, whole, non-shared ArrayBuffer -- never a
    // SharedArrayBuffer -- so narrowing its generic backing-buffer
    // parameter here is safe. Blob's DOM typings require exactly
    // Uint8Array<ArrayBuffer>, not the wider Uint8Array<ArrayBufferLike>
    // that Uint8Array's own declaration defaults to (see loadFonts.ts for
    // the same underlying mismatch).
    const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'edited.pdf'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleDownload}
        disabled={!bytes}
        data-testid="download-button"
      >
        {isRendering ? 'Rendering…' : 'Download'}
      </Button>
    </div>
  )
}
