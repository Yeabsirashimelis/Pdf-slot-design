/**
 * The tick step for the rulers along the canvas's top and left edges. A
 * ruler reads PDF points from the page's top-left corner, growing right
 * (top ruler) or down (left ruler) -- display only, so the y axis runs the
 * way a reader expects on screen rather than PDF's bottom-up. The drawing
 * itself is @scena/react-ruler's (see Ruler.tsx); this picks the labelled
 * interval it is given, so labels never crowd as the zoom changes.
 */

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
