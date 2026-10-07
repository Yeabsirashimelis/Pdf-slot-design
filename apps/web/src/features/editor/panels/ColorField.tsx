'use client'

import { useState } from 'react'
import { HexColorPicker } from 'react-colorful'
import { rgbToCss, type RGB } from '@pdf-slot/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { hexToRgb, rgbToHex } from './colorHex'

/**
 * A small fixed palette, Sejda-style. Components are **0–1**, the range
 * `RGB` is defined in (see its doc comment in `@pdf-slot/core`) -- not CSS
 * bytes. Exported so a test can assert the range over the whole list.
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
  return rgbToHex(a) === rgbToHex(b)
}

/**
 * The colour control: a swatch and the hex, as Figma prints it, opening a
 * picker (react-colorful) with the palette under it. The hex can also be
 * typed straight into the field; it commits on Enter or blur when it
 * parses, and snaps back otherwise.
 */
export function ColorField({
  value,
  onChange,
  disabled = false,
}: {
  value: RGB
  onChange(color: RGB): void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const hex = rgbToHex(value)

  const commitDraft = () => {
    if (draft === null) return
    const parsed = hexToRgb(draft)
    setDraft(null)
    if (parsed && !sameColor(parsed, value)) onChange(parsed)
  }

  return (
    <div className="flex h-8 items-stretch rounded-lg border border-input dark:bg-input/30" data-testid="color-field">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-full rounded-r-none"
              disabled={disabled}
              aria-label="Text colour"
              data-testid="color-trigger"
            >
              <span className="block size-4 rounded-sm border border-border" style={{ backgroundColor: rgbToCss(value) }} />
            </Button>
          }
        />
        <PopoverContent align="start" className="w-auto p-3">
          <HexColorPicker color={`#${hex}`} onChange={(next) => {
            const parsed = hexToRgb(next)
            if (parsed) onChange(parsed)
          }} />
          <div className="mt-3 grid grid-cols-8 gap-1.5" data-testid="color-swatch-grid">
            {COLOR_SWATCHES.map((swatch) => (
              // Plain buttons inside a real Popover: a swatch is content,
              // not a re-implementation of any shadcn primitive.
              <button
                key={swatch.label}
                type="button"
                aria-label={swatch.label}
                data-testid={`color-swatch-${swatch.label.toLowerCase()}`}
                className="size-5 rounded-sm border border-border outline-none focus-visible:ring-3 focus-visible:ring-ring/50 data-[selected=true]:ring-2 data-[selected=true]:ring-ring"
                data-selected={sameColor(value, swatch.color)}
                style={{ backgroundColor: rgbToCss(swatch.color) }}
                onClick={() => {
                  onChange(swatch.color)
                  setOpen(false)
                }}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>
      <Input
        aria-label="Text colour (hex)"
        data-testid="color-hex"
        disabled={disabled}
        spellCheck={false}
        className="h-full min-w-0 flex-1 rounded-l-none border-0 bg-transparent px-2 font-mono text-xs uppercase dark:bg-transparent"
        value={draft ?? hex}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commitDraft()
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            setDraft(null)
            e.currentTarget.blur()
          }
        }}
      />
    </div>
  )
}
