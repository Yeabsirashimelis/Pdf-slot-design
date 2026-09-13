'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** Previous / "N of M" / next -- rendered only for a multi-page document, with its own leading separator. */
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
    <>
      <Separator orientation="vertical" className="h-6" />
      <div className="flex items-center gap-1" data-testid="page-controls">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="outline"
                size="icon-sm"
                disabled={pageIndex <= 0}
                onClick={() => onPageChange(pageIndex - 1)}
                aria-label="Previous page"
                data-testid="page-prev"
              >
                <ChevronLeft />
              </Button>
            }
          />
          <TooltipContent>Previous page</TooltipContent>
        </Tooltip>
        <span className="min-w-20 text-center text-sm tabular-nums" data-testid="page-indicator">
          {pageIndex + 1} of {pageCount}
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="outline"
                size="icon-sm"
                disabled={pageIndex >= pageCount - 1}
                onClick={() => onPageChange(pageIndex + 1)}
                aria-label="Next page"
                data-testid="page-next"
              >
                <ChevronRight />
              </Button>
            }
          />
          <TooltipContent>Next page</TooltipContent>
        </Tooltip>
      </div>
    </>
  )
}
