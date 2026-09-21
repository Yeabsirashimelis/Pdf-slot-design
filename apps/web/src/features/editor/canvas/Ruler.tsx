'use client'

import ScenaRuler from '@scena/react-ruler'
import { GeistSans } from 'geist/font/sans'
import { chooseStep } from './rulerTicks'
import { useThemeTokens } from './useThemeTokens'

export const RULER_THICKNESS = 20

/** A range along the ruler's axis, in PDF points from the page corner. */
export type RulerRange = { from: number; to: number }

/** Canvas colours cannot be `var()`s; these match globals.css's dark set. */
const TOKEN_FALLBACKS = {
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
 * rulers mark a selection.
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
  length,
  highlight = null,
}: {
  orientation: 'horizontal' | 'vertical'
  /** CSS px per point: the canvas's current screen scale. */
  scale: number
  /** CSS px along the ruler where the page corner (value 0) sits. */
  offset: number
  /** CSS px: the ruler's own length (the workspace's width or height). */
  length: number
  highlight?: RulerRange | null
}) {
  const colors = useThemeTokens(TOKEN_FALLBACKS)
  const { major, minor } = chooseStep(scale)
  const horizontal = orientation === 'horizontal'
  const ranges = highlight ? [[Math.min(highlight.from, highlight.to), Math.max(highlight.from, highlight.to)]] : []

  return (
    <div
      data-testid={`ruler-${orientation}`}
      aria-hidden
      style={{
        width: horizontal ? length : RULER_THICKNESS,
        height: horizontal ? RULER_THICKNESS : length,
        // The rulers sit over the canvas; wheel and pointer events go
        // through to it.
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      {length > 0 && (
        <ScenaRuler
          type={orientation}
          width={horizontal ? length : RULER_THICKNESS}
          height={horizontal ? RULER_THICKNESS : length}
          zoom={scale}
          unit={major}
          segment={Math.round(major / minor)}
          scrollPos={-offset / scale}
          negativeRuler
          backgroundColor={colors['--ruler']}
          lineColor={colors['--ruler-tick']}
          textColor={colors['--ruler-text']}
          font={`9px ${GeistSans.style.fontFamily}`}
          mainLineSize="100%"
          longLineSize={6}
          shortLineSize={3}
          textOffset={horizontal ? [3, 0] : [0, 3]}
          selectedRanges={ranges}
          selectedBackgroundColor={colors['--ruler-highlight']}
          selectedRangesText
          selectedRangesTextColor={colors['--slot-selection']}
        />
      )}
    </div>
  )
}
