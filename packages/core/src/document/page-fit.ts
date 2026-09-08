import type { PageSize } from './types'

export const A4: PageSize = { width: 595.28, height: 841.89 }
export const LETTER: PageSize = { width: 612, height: 792 }

/**
 * Choose the standard page whose aspect ratio is closest to the image, in the
 * matching orientation. The image is embedded at full resolution regardless, so
 * this affects print scale only, never quality.
 */
export function fitPageSize(imageW: number, imageH: number): PageSize {
  const landscape = imageW > imageH
  const target = imageW / imageH

  const candidates = [A4, LETTER].map((p) =>
    landscape ? { width: p.height, height: p.width } : p,
  )

  let best = candidates[0]!
  let bestDelta = Infinity
  for (const c of candidates) {
    const delta = Math.abs(c.width / c.height - target)
    if (delta < bestDelta) { best = c; bestDelta = delta }
  }
  return best
}
