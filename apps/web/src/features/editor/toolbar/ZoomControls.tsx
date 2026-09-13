'use client'

import { Maximize2, Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export const ZOOM_MIN = 0.25
export const ZOOM_MAX = 3
const ZOOM_STEP = 0.25

/** Exported so Editor's fit-width handler (which computes the target zoom
 * from measured layout width) clamps to the exact same bounds as the −/+
 * buttons here, rather than duplicating the range. */
export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))
}

/** −/percentage/+ and fit-width. `zoom` is the displayed scale (1 = fit-width). */
export function ZoomControls({
  zoom,
  onZoomChange,
  onFitWidth,
}: {
  zoom: number
  onZoomChange(zoom: number): void
  onFitWidth(): void
}) {
  return (
    <div className="flex items-center gap-1" data-testid="zoom-controls">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => onZoomChange(clampZoom(zoom - ZOOM_STEP))}
              aria-label="Zoom out"
              data-testid="zoom-out"
            >
              <Minus />
            </Button>
          }
        />
        <TooltipContent>Zoom out</TooltipContent>
      </Tooltip>
      <span className="min-w-11 text-center text-sm tabular-nums" data-testid="zoom-percentage">
        {Math.round(zoom * 100)}%
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => onZoomChange(clampZoom(zoom + ZOOM_STEP))}
              aria-label="Zoom in"
              data-testid="zoom-in"
            >
              <Plus />
            </Button>
          }
        />
        <TooltipContent>Zoom in</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="outline"
              size="icon-sm"
              onClick={onFitWidth}
              aria-label="Fit width"
              data-testid="zoom-fit-width"
            >
              <Maximize2 />
            </Button>
          }
        />
        <TooltipContent>Fit the page to the column (100%)</TooltipContent>
      </Tooltip>
    </div>
  )
}
