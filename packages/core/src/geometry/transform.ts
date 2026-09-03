export type Point = { x: number; y: number }

/**
 * Everything needed to map between the on-screen canvas and PDF user space.
 * `pageHeight` is in PDF points and is what the Y flip pivots around.
 */
export type Viewport = { zoom: number; pageHeight: number }

export function toPdfLength(screenLength: number, vp: Viewport): number {
  return screenLength / vp.zoom
}

export function toScreenLength(pdfLength: number, vp: Viewport): number {
  return pdfLength * vp.zoom
}

/** Screen space: origin top-left, Y down. PDF space: origin bottom-left, Y up. */
export function toPdfPoint(screen: Point, vp: Viewport): Point {
  return {
    x: toPdfLength(screen.x, vp),
    y: vp.pageHeight - toPdfLength(screen.y, vp),
  }
}

export function toScreenPoint(pdf: Point, vp: Viewport): Point {
  return {
    x: toScreenLength(pdf.x, vp),
    y: toScreenLength(vp.pageHeight - pdf.y, vp),
  }
}
