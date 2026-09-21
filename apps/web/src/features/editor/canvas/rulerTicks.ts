/**
 * Tick layout for the rulers along the canvas's top and left edges. A
 * ruler reads PDF points from the page's top-left corner, growing right
 * (top ruler) or down (left ruler) -- display only, so the y axis runs the
 * way a reader expects on screen rather than PDF's bottom-up. The page
 * origin sits at `offsetPx` (the view's pan on that axis) and a value `v`
 * at `offsetPx + v * zoom`.
 */
export type Tick = {
  /** CSS px along the ruler. */
  px: number
  /** PDF points from the page corner. */
  value: number
  /** Set on major ticks only. */
  label: string | null
}

/** The 1-2-5 series, in points, that major ticks are chosen from. */
const STEPS: readonly number[] = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000]

/**
 * The smallest step whose labels sit at least `minLabelPx` apart at this
 * zoom, with its subdivision: fifths for 1- and 5-series steps (10 → 2,
 * 50 → 10), quarters for the 2-series (20 → 5), so minor ticks always
 * land on round numbers.
 */
export function chooseStep(zoom: number, minLabelPx = 60): { major: number; minor: number } {
  const major = STEPS.find((step) => step * zoom >= minLabelPx) ?? STEPS[STEPS.length - 1]
  const leading = Number(String(major)[0])
  return { major, minor: leading === 2 ? major / 4 : major / 5 }
}

/** Every tick that falls inside `[0, lengthPx)` of the ruler. */
export function rulerTicks(zoom: number, offsetPx: number, lengthPx: number, minLabelPx = 60): Tick[] {
  const { major, minor } = chooseStep(zoom, minLabelPx)
  // Iterate over integer multiples of `minor` rather than accumulating a
  // float, so the labels and the "is this a major tick" test are exact.
  const firstIndex = Math.ceil((0 - offsetPx) / zoom / minor)
  const lastIndex = Math.ceil((lengthPx - offsetPx) / zoom / minor)
  const perMajor = Math.round(major / minor)
  const ticks: Tick[] = []
  for (let i = firstIndex; i < lastIndex; i++) {
    const value = i * minor
    const px = offsetPx + value * zoom
    if (px < 0 || px >= lengthPx) continue
    const isMajor = i % perMajor === 0
    ticks.push({ px, value, label: isMajor ? String(Math.round(value)) : null })
  }
  return ticks
}
