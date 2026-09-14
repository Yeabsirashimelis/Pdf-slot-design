/**
 * The name a download is saved under: the uploaded file's own name, with
 * `.pdf` in place of an image extension (an uploaded PNG/JPEG becomes a
 * PDF), path separators replaced, and a fallback when nothing usable is
 * known.
 */
export function downloadName(originalName: string | undefined): string {
  const trimmed = (originalName ?? '').trim().replace(/[\\/]+/g, '-')
  const stem = trimmed.replace(/\.[a-z0-9]+$/i, '')
  if (stem === '') return 'edited.pdf'
  return `${stem}.pdf`
}
