'use client'

import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import type { Slot } from '@pdf-slot/core'
import { DownloadButton } from './DownloadButton'
import { PageControls } from './PageControls'
import { SlotStyleControls } from './SlotStyleControls'
import { ZoomControls } from './ZoomControls'

// Re-exported for callers that import them from the toolbar's entry point
// (Editor's fit-width clamp; test/Toolbar.test.ts's swatch-range check).
export { COLOR_SWATCHES } from './SlotStyleControls'
export { ZOOM_MAX, ZOOM_MIN, clampZoom } from './ZoomControls'

export type ToolbarProps = {
  isRendering: boolean
  /**
   * Produces the output PDF for the current slots -- the one render a
   * download performs (from scratch the first time, an increment on top
   * of the last output after that; reused as-is when nothing changed).
   * Resolves `null` when rendering failed, in which case nothing is
   * saved: the failure is already surfaced to the user by Editor's error
   * toast, and silently handing out the source or a stale file instead
   * would lose their edits without telling them. See
   * `pipeline/useCommitRender.ts`'s `render`.
   */
  render(): Promise<Uint8Array | null>
  /**
   * When non-null, Download is blocked and this explains why. Spec §8's
   * export gate: a slot containing characters no bundled face can encode
   * must not be exported as `.notdef` boxes. Editor owns the check (it owns
   * the font metrics); Toolbar only refuses to hand out the file.
   *
   * The button stays `aria-disabled`, not natively `disabled`: a native
   * `disabled` attribute makes the element unfocusable and suppresses
   * pointer events, so a Tooltip anchored to it could never open by hover
   * or keyboard. Blocking is enforced by the `if (downloadBlockedReason)
   * return` guard at the top of `handleDownload` instead, and the reason
   * is surfaced twice -- in the Tooltip on hover/focus, and via the
   * `sonner` toast Editor raises for the same value (see Editor.tsx).
   */
  downloadBlockedReason: string | null
  slots: Slot[]
  selectedId: string | null
  /**
   * Updates the given slot AND closes the undo boundary AND re-renders the
   * real output, synchronously, before returning -- see
   * `pipeline/slotCommands.ts`'s `createSlotCommands` (what Editor.tsx
   * builds this from). Deliberately not split into a separate "update" +
   * "commit" pair: Toolbar's own controls have no gap between the two
   * calls (unlike SlotOverlay's onChange/onCommit, which are separated by
   * further keystroke/pointermove renders), so composing them here
   * previously left `commit()` reading one render behind -- see
   * task-17-report.md's fix-round-1 finding. Collapsing the two into one
   * call that's implemented with `flushSync` means no future control can
   * reintroduce that gap by forgetting to flush.
   */
  updateSlotAndCommit(id: string, patch: Partial<Slot>): void
  removeSlotAndCommit(id: string): void
  duplicateSlotAndCommit(id: string): string | null
  zoom: number
  onZoomChange(zoom: number): void
  /** Sets zoom so the current page's width fills the available viewport
   * width. Geometry lives in Editor (it owns the layout to measure),
   * Toolbar just exposes the button. */
  onFitWidth(): void
  pageIndex: number
  pageCount: number
  onPageChange(index: number): void
  /**
   * Clears the persisted session (Task 18) and returns to the dropzone.
   * Optional so every existing Toolbar test that doesn't pass it keeps
   * rendering exactly as before -- the control itself is simply omitted.
   */
  onStartOver?(): void
  /** Step 2: slots are locked, so the per-slot style controls are hidden rather than merely disabled. */
  locked?: boolean
}

/**
 * Toolbar acting on the selected text slot, plus zoom and page navigation.
 * Composed entirely from shadcn/ui primitives (see CLAUDE.md's shadcn
 * rule) -- the only hand-rolled element in this file is the colour swatch
 * grid's individual `<button>`s, which are plain content inside a real
 * Popover, not a re-implementation of any shadcn primitive itself.
 */
/**
 * Toolbar acting on the selected text slot, plus zoom, page navigation,
 * download and start over. Composed from the four groups beside it, all
 * built from shadcn/ui primitives (see CLAUDE.md's shadcn rule).
 */
export function Toolbar({
  isRendering,
  render,
  downloadBlockedReason,
  slots,
  selectedId,
  updateSlotAndCommit,
  removeSlotAndCommit,
  duplicateSlotAndCommit,
  zoom,
  onZoomChange,
  onFitWidth,
  pageIndex,
  pageCount,
  onPageChange,
  onStartOver,
  locked = false,
}: ToolbarProps) {
  const selected = slots.find((slot) => slot.id === selectedId) ?? null

  return (
    <TooltipProvider>
      <div
        className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2"
        data-testid="toolbar"
      >
        {!locked && (
          <SlotStyleControls
            selected={selected}
            applyPatch={(patch: Partial<Slot>) => {
              if (selected) updateSlotAndCommit(selected.id, patch)
            }}
            onDuplicate={() => {
              if (selected) duplicateSlotAndCommit(selected.id)
            }}
            onDelete={() => {
              if (selected) removeSlotAndCommit(selected.id)
            }}
          />
        )}

        <ZoomControls zoom={zoom} onZoomChange={onZoomChange} onFitWidth={onFitWidth} />

        <PageControls pageIndex={pageIndex} pageCount={pageCount} onPageChange={onPageChange} />

        <Separator orientation="vertical" className="h-6" />

        <DownloadButton isRendering={isRendering} render={render} downloadBlockedReason={downloadBlockedReason} />

        {onStartOver && (
          <>
            <Separator orientation="vertical" className="h-6" />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button variant="outline" size="sm" onClick={onStartOver} data-testid="start-over-button">
                    Start over
                  </Button>
                }
              />
              <TooltipContent>Close this file and go back to upload. Your saved layout is kept.</TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
    </TooltipProvider>
  )
}
