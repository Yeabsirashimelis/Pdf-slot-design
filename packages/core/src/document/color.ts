import type { RGB } from './types'

/**
 * The single conversion from a slot's stored colour to a CSS colour string.
 *
 * There is exactly one of these on purpose. `RGB`'s components are 0–1 (see
 * its doc comment on `types.ts`) because that is what `pdf-lib`'s `rgb()`
 * takes on the export side, but CSS wants 0–255. Every browser-side consumer
 * — the overlay's line spans, the textarea's caret colour, the toolbar's
 * swatch buttons — needs that same conversion, and when each wrote its own,
 * they drifted: the toolbar's palette was authored in bytes and rendered
 * without scaling (so it looked right), while the overlay multiplied by 255
 * (so the same value came out as `rgb(9435 ...)`, clamped to white, and the
 * text disappeared from the preview). Routing all three through this
 * function means a units mismatch cannot be visible in one place and
 * invisible in another.
 *
 * Components are clamped rather than trusted: an out-of-range value would be
 * clamped by the browser anyway, so clamping here hides nothing, and it
 * keeps the emitted string well-formed for tests to assert on.
 */
export function rgbToCss(color: RGB): string {
  return `rgb(${channel(color.r)}, ${channel(color.g)}, ${channel(color.b)})`
}

function channel(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 255)
}
