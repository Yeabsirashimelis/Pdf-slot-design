'use client'

import { Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * The floating zoom pill over the canvas: −, the percentage, +. The
 * percentage is a menu (as in Figma) with the zooms a keyboard reaches
 * too. `scale` is CSS px per PDF point, so 100% is print size.
 */
export function ZoomControls({
  scale,
  onZoomIn,
  onZoomOut,
  onZoomTo,
  onFit,
}: {
  scale: number
  onZoomIn(): void
  onZoomOut(): void
  onZoomTo(scale: number): void
  /** Show the whole page, as large as the workspace allows. */
  onFit(): void
}) {
  return (
    <div
      className="flex items-center rounded-md border border-border bg-background shadow-sm"
      data-testid="zoom-controls"
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="ghost" size="icon-sm" onClick={onZoomOut} aria-label="Zoom out" data-testid="zoom-out">
              <Minus />
            </Button>
          }
        />
        <TooltipContent>Zoom out</TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="min-w-14 px-1 font-normal tabular-nums"
              aria-label="Zoom options"
              data-testid="zoom-percentage"
            >
              {Math.round(scale * 100)}%
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem onClick={onZoomIn} data-testid="zoom-menu-in">
            Zoom in <DropdownMenuShortcut>Ctrl +</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onZoomOut} data-testid="zoom-menu-out">
            Zoom out <DropdownMenuShortcut>Ctrl −</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onFit} data-testid="zoom-menu-fit">
            Zoom to fit <DropdownMenuShortcut>Ctrl 0</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onZoomTo(0.5)} data-testid="zoom-menu-50">
            Zoom to 50%
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onZoomTo(1)} data-testid="zoom-menu-100">
            Zoom to 100%
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onZoomTo(2)} data-testid="zoom-menu-200">
            Zoom to 200%
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="ghost" size="icon-sm" onClick={onZoomIn} aria-label="Zoom in" data-testid="zoom-in">
              <Plus />
            </Button>
          }
        />
        <TooltipContent>Zoom in</TooltipContent>
      </Tooltip>
    </div>
  )
}
