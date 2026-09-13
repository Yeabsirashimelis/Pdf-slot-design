'use client'

import { useState } from 'react'
import { AlignCenter, AlignLeft, AlignRight, Copy, Trash2 } from 'lucide-react'
import { FONT_IDS, FONT_LABELS, rgbToCss, type Align, type FontId, type RGB, type Slot } from '@pdf-slot/core'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Kbd } from '@/components/ui/kbd'
import { Hint } from '@/components/hint'

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


function sameColor(a: RGB, b: RGB): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b
}

/**
 * The per-slot controls -- font, size, colour, alignment, duplicate,
 * delete -- shown in the layout step only (the write step locks slots).
 * Every change funnels through `applyPatch`, which the parent implements
 * as update-and-commit; see ToolbarProps.
 */
export function SlotStyleControls({
  selected,
  applyPatch,
  onDuplicate,
  onDelete,
}: {
  selected: Slot | null
  applyPatch(patch: Partial<Slot>): void
  onDuplicate(): void
  onDelete(): void
}) {
  const [colorPopoverOpen, setColorPopoverOpen] = useState(false)
  return (
    <>
      <Hint label="Font of the selected slot">
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
      </Hint>

      <Hint label="Text size (points)">
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
      </Hint>

      <Separator orientation="vertical" className="h-6" />

      {/* The hint wraps the Popover (see Hint): a Tooltip trigger on the
       * same button as the Popover trigger would fight it for the click. */}
      <Hint label="Text colour">
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
      </Hint>

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
        <Hint label="Align left">
          <ToggleGroupItem value="left" aria-label="Align left" data-testid="align-left">
            <AlignLeft />
          </ToggleGroupItem>
        </Hint>
        <Hint label="Align centre">
          <ToggleGroupItem value="center" aria-label="Align center" data-testid="align-center">
            <AlignCenter />
          </ToggleGroupItem>
        </Hint>
        <Hint label="Align right">
          <ToggleGroupItem value="right" aria-label="Align right" data-testid="align-right">
            <AlignRight />
          </ToggleGroupItem>
        </Hint>
      </ToggleGroup>

      <Separator orientation="vertical" className="h-6" />

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="outline"
              size="icon-sm"
              disabled={!selected}
              onClick={onDuplicate}
              aria-label="Duplicate slot"
              data-testid="duplicate-button"
            >
              <Copy />
            </Button>
          }
        />
        <TooltipContent>
          Duplicate slot <Kbd>Ctrl</Kbd><Kbd>D</Kbd>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="destructive"
              size="icon-sm"
              disabled={!selected}
              onClick={onDelete}
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
    </>
  )
}
