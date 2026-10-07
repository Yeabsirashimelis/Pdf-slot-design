export type ClientPoint = { x: number; y: number }
/** CSS px from the page's top-left corner, in the stage's own unscaled frame (1 px = 1 PDF point). */
export type StagePoint = { x: number; y: number }
/** Only the fields of `DOMRect` this conversion needs. */
export type CanvasRect = { left: number; top: number }

/**
 * Convert a pointer event's client coordinates into stage coordinates:
 * CSS px from the page's top-left corner as the stage is laid out, before
 * the canvas's CSS transform scales it on screen.
 *
 * The stage is laid out at 1 px per PDF point and the zoom/pan canvas
 * scales it by `screenScale` with a CSS transform. `rect` must come from
 * `canvas.getBoundingClientRect()`, which reports the *transformed* box
 * in CSS pixels -- so the distance from its corner is in screen px, and
 * dividing by `screenScale` gets back to the stage's frame.
 *
 * This function must never read or multiply by `devicePixelRatio`. Doing
 * so is the classic bug in this kind of editor: `canvas.width` is `dpr`
 * times larger than the CSS box, and mixing the two makes every placed
 * slot drift on a retina display while looking fine on a 1x one.
 */
export function toStagePoint(rect: CanvasRect, client: ClientPoint, screenScale: number): StagePoint {
  return {
    x: (client.x - rect.left) / screenScale,
    y: (client.y - rect.top) / screenScale,
  }
}
