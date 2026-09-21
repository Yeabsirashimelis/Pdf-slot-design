'use client'

import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** The floating page pill over the canvas: up, "N / M", down -- rendered only for a multi-page document. */
export function PageControls({
  pageIndex,
  pageCount,
  onPageChange,
}: {
  pageIndex: number
  pageCount: number
  onPageChange(index: number): void
}) {
  if (pageCount <= 1) return null
  return (
    <div
      className="flex items-center rounded-md border border-border bg-background shadow-sm"
      data-testid="page-controls"
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={pageIndex <= 0}
              onClick={() => onPageChange(pageIndex - 1)}
              aria-label="Previous page"
              data-testid="page-prev"
            >
              <ChevronUp />
            </Button>
          }
        />
        <TooltipContent>Previous page</TooltipContent>
      </Tooltip>
      <span className="min-w-12 px-1 text-center text-[0.8rem] tabular-nums" data-testid="page-indicator">
        {pageIndex + 1} / {pageCount}
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={pageIndex >= pageCount - 1}
              onClick={() => onPageChange(pageIndex + 1)}
              aria-label="Next page"
              data-testid="page-next"
            >
              <ChevronDown />
            </Button>
          }
        />
        <TooltipContent>Next page</TooltipContent>
      </Tooltip>
    </div>
  )
}
