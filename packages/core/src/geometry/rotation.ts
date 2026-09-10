import type { PageSize } from '../document/types'
import type { Point } from './transform'

/**
 * A page's `/Rotate` entry, folded into the four values PDF allows.
 *
 * Two coordinate spaces meet here, and it matters which one a number is in:
 *
 * - **Unrotated user space** is what the page's content stream is written
 *   in: the media box, origin bottom-left, `/Rotate` not yet applied. This
 *   is the space `page.drawText` places glyphs in.
 * - **Displayed space** is what every viewer shows -- and what pdf.js paints
 *   on the editor's canvas: the same page turned by `/Rotate`, origin at
 *   the bottom-left of the *turned* page. A quarter turn swaps its width
 *   and height. This is the space `Slot.x`/`Slot.y` live in, because that
 *   is the page the user is looking at when they click.
 *
 * The functions below are the only place the two are converted. Keeping
 * the slot model in displayed space means nothing on the web side has to
 * know a page is rotated; only the export does, at the moment it draws.
 */
export type PageRotation = 0 | 90 | 180 | 270

export function normalizeRotation(degrees: number): PageRotation {
  const folded = ((Math.round(degrees) % 360) + 360) % 360
  if (folded === 90 || folded === 180 || folded === 270) return folded
  return 0
}

/** The size a viewer shows the page at: axes swapped for quarter turns. */
export function displayedPageSize(unrotated: PageSize, rotation: PageRotation): PageSize {
  return rotation === 90 || rotation === 270
    ? { width: unrotated.height, height: unrotated.width }
    : { width: unrotated.width, height: unrotated.height }
}

/**
 * Maps a point in displayed space back into the page's unrotated user
 * space. `unrotated` is the page's own (media box) size, NOT the displayed
 * one.
 *
 * Derived by tracking where each corner of the displayed page came from.
 * `/Rotate 90` turns the page clockwise for display, so the displayed
 * bottom-left corner is the unrotated bottom-right, and moving right along
 * the displayed bottom edge walks *up* the unrotated right edge:
 * `(dx, dy) -> (W - dy, dx)`. `/Rotate 270` is the anticlockwise twin, and
 * 180 is a point reflection through the centre.
 *
 * Text drawn at the mapped point must also be turned by the same angle
 * (pdf-lib's `rotate` option, anticlockwise-positive like PDF itself) so
 * that once the viewer applies `/Rotate` it reads upright again.
 */
export function toUnrotatedPoint(displayed: Point, unrotated: PageSize, rotation: PageRotation): Point {
  switch (rotation) {
    case 0:
      return { x: displayed.x, y: displayed.y }
    case 90:
      return { x: unrotated.width - displayed.y, y: displayed.x }
    case 180:
      return { x: unrotated.width - displayed.x, y: unrotated.height - displayed.y }
    case 270:
      return { x: displayed.y, y: unrotated.height - displayed.x }
  }
}
