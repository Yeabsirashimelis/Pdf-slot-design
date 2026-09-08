'use client'

import { useState } from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minus,
  Plus,
  Trash2,
} from 'lucide-react'
import {
  FONT_IDS,
  FONT_LABELS,
  rgbToCss,
  type Align,
  type EditorDocument,
  type FontId,
  type RGB,
  type Slot,
} from '@pdf-slot/core'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

/** Selectable point sizes -- no such list exists in @pdf-slot/core, so this
 * is the toolbar's own convention (a standard print/editor size ramp). */
const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72]

/**
 * Small fixed colour palette for the swatch grid, Sejda-style.
 *
 * Components are **0–1**, the range `RGB` is defined in (see its doc comment
 * in `@pdf-slot/core`) -- not CSS bytes. These values go straight into
 * `Slot.color`, which `renderPdf` hands to pdf-lib's `rgb()`. Authoring them
 * as 0–255 (as this list originally did) made pdf-lib throw on export and
 * made the overlay's own 255-scaling clamp the text to white, so every
 * non-black swatch broke both halves of the guarantee at once. Exported so
 * `test/Toolbar.test.ts` can assert the range over the whole list rather
 * than one swatch at a time.
 */
export const COLOR_SWATCHES: { label: string; color: RGB }[] = [
  { label: 'Black', color: { r: 0, g: 0, b: 0 } },
  { label: 'White', color: { r: 1, g: 1, b: 1 } },
  { label: 'Red', color: { r: 220 / 255, g: 38 / 255, b: 38 / 255 } },
  { label: 'Orange', color: { r: 234 / 255, g: 88 / 255, b: 12 / 255 } },
  { label: 'Yellow', color: { r: 202 / 255, g: 138 / 255, b: 4 / 255 } },
  { label: 'Green', color: { r: 22 / 255, g: 163 / 255, b: 74 / 255 } },
  { label: 'Blue', color: { r: 37 / 255, g: 99 / 255, b: 235 / 255 } },
  { label: 'Purple', color: { r: 124 / 255, g: 58 / 255, b: 237 / 255 } },
]

export const ZOOM_MIN = 0.25
export const ZOOM_MAX = 3
const ZOOM_STEP = 0.25

/** Exported so Editor's fit-width handler (which computes the target zoom
 * from measured layout width) clamps to the exact same bounds as the −/+
 * buttons here, rather than duplicating the range. */
export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))
}

function sameColor(a: RGB, b: RGB): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b
}

export type ToolbarProps = {
  /** Always available: an unedited document is still a legitimate download. */
  doc: EditorDocument
  /** The real, already-rendered output PDF, if a commit has happened yet. */
  bytes: Uint8Array | null
  isRendering: boolean
  /**
   * Settles any render already in flight and yields its bytes, so Download
   * cannot save a stale file. Pressing Download blurs the focused textarea,
   * and blur *is* the commit boundary: the mousedown starts `renderPdf`,
   * and the click that follows would otherwise read a `bytes` prop that has
   * not caught up -- `null` on a first edit, which fell through to
   * `doc.source` and saved the document without the user's text in it. See
   * `pipeline/useCommitRender.ts`'s `flush`.
   */
  flush(): Promise<Uint8Array | null>
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
}

/**
 * Toolbar acting on the selected text slot, plus zoom and page navigation.
 * Composed entirely from shadcn/ui primitives (see CLAUDE.md's shadcn
 * rule) -- the only hand-rolled element in this file is the colour swatch
 * grid's individual `<button>`s, which are plain content inside a real
 * Popover, not a re-implementation of any shadcn primitive itself.
 */
export function Toolbar({
  doc,
  bytes,
  isRendering,
  flush,
  downloadBlockedReason,
  slots,
  selectedId,
  updateSlotAndCommit,
  removeSlotAndCommit,
  zoom,
  onZoomChange,
  onFitWidth,
  pageIndex,
  pageCount,
  onPageChange,
  onStartOver,
}: ToolbarProps) {
  const selected = slots.find((slot) => slot.id === selectedId) ?? null
  const [colorPopoverOpen, setColorPopoverOpen] = useState(false)

  /** Every control below funnels its change through this -- see
   * `updateSlotAndCommit`'s doc comment on `ToolbarProps`. */
  const applyPatch = (patch: Partial<Slot>) => {
    if (!selected) return
    updateSlotAndCommit(selected.id, patch)
  }

  const handleDelete = () => {
    if (!selected) return
    removeSlotAndCommit(selected.id)
  }

  const handleDownload = async () => {
    if (downloadBlockedReason) return
    // Wait for whatever this very click's own mousedown set going: blurring
    // the focused textarea is the commit boundary, so a render is typically
    // already in flight by the time the click lands, and `bytes` below is
    // one render behind it. `flush()` resolves to those fresher bytes, or
    // to null when nothing was in flight.
    const rendered = await flush()
    // Falls back to the unedited source: a user who uploads and
    // immediately downloads without editing anything still gets a file,
    // rather than a dead button (see task-17-brief.md's deferred-item
    // fix). Otherwise the real output wins -- never re-derived, exactly
    // like Task 16 required; `flush()` returns bytes an already-running
    // `renderPdf` produced, it never starts one.
    const data = rendered ?? bytes ?? doc.source
    const blob = new Blob([data as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'edited.pdf'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <TooltipProvider>
      <div
        className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background p-2"
        data-testid="toolbar"
      >
        <Select
          value={selected?.fontId ?? ''}
          onValueChange={(value) => applyPatch({ fontId: value as FontId })}
          disabled={!selected}
        >
          <SelectTrigger size="sm" className="w-32" data-testid="font-select-trigger">
            <SelectValue placeholder="Font" />
          </SelectTrigger>
          <SelectContent>
            {FONT_IDS.map((id) => (
              <SelectItem key={id} value={id} data-testid={`font-option-${id}`}>
                {FONT_LABELS[id]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={selected ? String(selected.size) : ''}
          onValueChange={(value) => applyPatch({ size: Number(value) })}
          disabled={!selected}
        >
          <SelectTrigger size="sm" className="w-16" data-testid="size-select-trigger">
            <SelectValue placeholder="Size" />
          </SelectTrigger>
          <SelectContent>
            {FONT_SIZES.map((size) => (
              <SelectItem key={size} value={String(size)} data-testid={`size-option-${size}`}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Separator orientation="vertical" className="h-6" />

        {/* No Tooltip here: the trigger already opens a Popover on click,
         * and layering a hover Tooltip's own trigger over the same button
         * fights the Popover for the same interaction. An aria-label
         * carries the accessible name instead. */}
        <Popover open={colorPopoverOpen} onOpenChange={setColorPopoverOpen}>
          <PopoverTrigger
            render={
              <Button
                variant="outline"
                size="icon-sm"
                disabled={!selected}
                aria-label="Text colour"
                data-testid="color-trigger"
              >
                <span
                  className="block size-4 rounded-full border border-border"
                  style={selected ? { backgroundColor: rgbToCss(selected.color) } : undefined}
                />
              </Button>
            }
          />
          <PopoverContent className="w-auto">
            <div className="grid grid-cols-4 gap-1.5" data-testid="color-swatch-grid">
              {COLOR_SWATCHES.map((swatch) => (
                <button
                  key={swatch.label}
                  type="button"
                  aria-label={swatch.label}
                  data-testid={`color-swatch-${swatch.label.toLowerCase()}`}
                  className="size-6 rounded-md border border-border outline-none focus-visible:ring-3 focus-visible:ring-ring/50 data-[selected=true]:ring-2 data-[selected=true]:ring-ring"
                  data-selected={selected ? sameColor(selected.color, swatch.color) : false}
                  style={{ backgroundColor: rgbToCss(swatch.color) }}
                  onClick={() => {
                    applyPatch({ color: swatch.color })
                    setColorPopoverOpen(false)
                  }}
                />
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <ToggleGroup
          value={selected ? [selected.align] : []}
          onValueChange={(values: string[]) => {
            // ToggleGroup allows deselecting down to an empty array; an
            // alignment control must always keep exactly one value, so an
            // attempted deselect (clicking the already-pressed item) is
            // ignored rather than committing an empty alignment.
            const next = values[0] as Align | undefined
            if (next) applyPatch({ align: next })
          }}
          disabled={!selected}
          data-testid="align-toggle-group"
        >
          <ToggleGroupItem value="left" aria-label="Align left" data-testid="align-left">
            <AlignLeft />
          </ToggleGroupItem>
          <ToggleGroupItem value="center" aria-label="Align center" data-testid="align-center">
            <AlignCenter />
          </ToggleGroupItem>
          <ToggleGroupItem value="right" aria-label="Align right" data-testid="align-right">
            <AlignRight />
          </ToggleGroupItem>
        </ToggleGroup>

        <Separator orientation="vertical" className="h-6" />

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="destructive"
                size="icon-sm"
                disabled={!selected}
                onClick={handleDelete}
                aria-label="Delete slot"
                data-testid="delete-button"
              >
                <Trash2 />
              </Button>
            }
          />
          <TooltipContent>Delete slot</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="h-6" />

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
            <TooltipContent>Fit width</TooltipContent>
          </Tooltip>
        </div>

        {pageCount > 1 && (
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
        )}

        <Separator orientation="vertical" className="h-6" />

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                aria-disabled={downloadBlockedReason !== null}
                onClick={() => {
                  void handleDownload()
                }}
                data-testid="download-button"
              >
                {isRendering ? 'Rendering…' : 'Download'}
              </Button>
            }
          />
          <TooltipContent>{downloadBlockedReason ?? 'Download the edited PDF'}</TooltipContent>
        </Tooltip>

        {onStartOver && (
          <>
            <Separator orientation="vertical" className="h-6" />
            <Button variant="outline" size="sm" onClick={onStartOver} data-testid="start-over-button">
              Start over
            </Button>
          </>
        )}
      </div>
    </TooltipProvider>
  )
}
