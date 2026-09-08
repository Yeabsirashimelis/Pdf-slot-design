export type ClientPoint = { x: number; y: number }
export type LogicalPoint = { x: number; y: number }
/** Only the fields of `DOMRect` this conversion needs. */
export type CanvasRect = { left: number; top: number }

/**
 * Convert a pointer event's client coordinates into logical (CSS-pixel)
 * coordinates relative to a canvas's top-left corner.
 *
 * `rect` must come from `canvas.getBoundingClientRect()`, which is always
 * reported in CSS pixels -- so this function must never read or multiply by
 * `devicePixelRatio`. Doing so is the classic bug in this kind of editor:
 * `canvas.width` is `dpr` times larger than the CSS box, and mixing the two
 * makes every placed slot drift on a retina display while looking fine on a
 * 1x one.
 *
 * `zoom` is accepted to mirror the render path's inputs, but the
 * conversion itself doesn't scale by it: the canvas's CSS size already has
 * zoom baked in (see `PageCanvas`, whose `style.width` is
 * `viewport.width / dpr` where `viewport` was built from `zoom * dpr`), so
 * `rect` is already zoom-correct. Re-applying zoom here would double it.
 */
export function toLogicalPoint(
  rect: CanvasRect,
  client: ClientPoint,
  zoom: number,
): LogicalPoint {
  void zoom
  return {
    x: client.x - rect.left,
    y: client.y - rect.top,
  }
}
