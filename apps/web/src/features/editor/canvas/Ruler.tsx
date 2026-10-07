'use client'

import ScenaRuler from '@scena/react-ruler'
import { chooseStep } from './rulerTicks'
import { useThemeTokens } from './useThemeTokens'

export const RULER_THICKNESS = 20

/** A range along the ruler's axis, in PDF points from the page corner. */
export type RulerRange = { from: number; to: number }

/**
 * A canvas cannot say `var()`: colours (these match globals.css's dark
 * set) and the app font (the family string next/font puts on <html>).
 */
const TOKEN_FALLBACKS = {
  '--font-geist-sans': 'system-ui, sans-serif',
  '--ruler': '#2c2c2c',
  '--ruler-tick': '#6f6f6f',
  '--ruler-text': '#9a9a9a',
  '--ruler-highlight': '#354465',
  '--slot-selection': '#0d99ff',
}

/**
 * One ruler along an edge of the canvas, drawn by @scena/react-ruler: the
 * top one reads x, the left one reads y, both in points from the page's
 * top-left corner (see rulerTicks). The selected slot's extent is washed
 * in and its two edges are labelled in the accent colour, the way Figma's
 * rulers mark a selection. Fills whatever box it is given and re-measures
 * itself when that box resizes.
 *
 * The library thinks in "units at a zoom": a unit is one point, `zoom` is
 * the screen scale, and `scrollPos` is the value at the ruler's start --
 * the page corner sits `offset` px along the ruler, so the start reads
 * `-offset / scale`.
 */
export function Ruler({
  orientation,
  scale,
  offset,
  highlight = null,
}: {
  orientation: 'horizontal' | 'vertical'
  /** CSS px per point: the canvas's current screen scale. */
  scale: number
  /** CSS px along the ruler where the page corner (value 0) sits. */
  offset: number
  highlight?: RulerRange | null
}) {
  const colors = useThemeTokens(TOKEN_FALLBACKS)
  const { major, minor } = chooseStep(scale)
  const horizontal = orientation === 'horizontal'
  // Whole points: the library prints the range's ends verbatim.
  const ranges = highlight
    ? [[Math.round(Math.min(highlight.from, highlight.to)), Math.round(Math.max(highlight.from, highlight.to))]]
    : []
  // The library places labels for a 30px bar (17px in from the far edge);
  // on a 20px one they are nudged so the digits sit inside it, and a
  // vertical label runs upward from just above its tick.
  const textOffset = horizontal ? [3, 10] : [10, -3]

  return (
    <div
      data-testid={`ruler-${orientation}`}
      aria-hidden
      style={{
        position: 'absolute',
        top: horizontal ? 0 : RULER_THICKNESS,
        left: horizontal ? RULER_THICKNESS : 0,
        right: horizontal ? 0 : undefined,
        bottom: horizontal ? undefined : 0,
        width: horizontal ? undefined : RULER_THICKNESS,
        height: horizontal ? RULER_THICKNESS : undefined,
        // The rulers sit over the canvas; wheel and pointer events go
        // through to it.
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      <ScenaRuler
        type={orientation}
        style={{ width: '100%', height: '100%' }}
        // jsdom has no ResizeObserver (and mocks this component anyway).
        useResizeObserver={typeof ResizeObserver !== 'undefined'}
        zoom={scale}
        unit={major}
        segment={Math.round(major / minor)}
        scrollPos={-offset / scale}
        negativeRuler
        backgroundColor={colors['--ruler']}
        lineColor={colors['--ruler-tick']}
        textColor={colors['--ruler-text']}
        font={`9px ${colors['--font-geist-sans']}`}
        mainLineSize="100%"
        longLineSize={6}
        shortLineSize={3}
        textOffset={textOffset}
        selectedRanges={ranges}
        selectedBackgroundColor={colors['--ruler-highlight']}
        selectedRangesText
        selectedRangesTextColor={colors['--slot-selection']}
        selectedRangesTextOffset={textOffset}
      />
    </div>
  )
}
