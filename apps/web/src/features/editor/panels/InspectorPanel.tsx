'use client'

import { useState, type KeyboardEvent } from 'react'
import { AlignCenter, AlignLeft, AlignRight, Save } from 'lucide-react'
import type { Align, Slot, TemplateTable } from '@pdf-slot/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Hint } from '@/components/hint'
import { DownloadButton } from '../toolbar/DownloadButton'
import { ColorField } from './ColorField'
import { FONT_FAMILIES, FONT_WEIGHTS, hasBold, toFontChoice, toFontId, type FontFamily, type FontWeight } from './fontChoice'
import { NumberField } from './NumberField'
import { TableInspector } from '@/features/editor/table/TableInspector'

/**
 * The right column: Download and Save on top, then the selected slot's
 * name and typography -- family, weight, size, line height, alignment,
 * colour -- as Figma's inspector lays them out. Every change funnels
 * through `applyPatch`, which the parent implements as update-and-commit
 * (see slotCommands.ts). With nothing selected the controls show but are
 * disabled, so the panel never jumps.
 */
export function InspectorPanel({
  selected,
  name,
  nameReadOnly = false,
  onRename,
  applyPatch,
  locked = false,
  isRendering,
  render,
  downloadBlockedReason,
  fileName,
  emptySlots,
  onSave,
  table = null,
  onRenameColumn,
  onResizeColumn,
  onAddColumn,
  onRemoveColumn,
}: {
  selected: Slot | null
  /** The selected slot's name (the parent owns names). */
  name: string
  /** A table cell is named by its column and row, so its name is shown but not edited here. */
  nameReadOnly?: boolean
  onRename(name: string): void
  applyPatch(patch: Partial<Slot>): void
  /** The layout is frozen: typography is read-only too, since it moves text. */
  locked?: boolean
  isRendering: boolean
  render(): Promise<Uint8Array | null>
  downloadBlockedReason: string | null
  fileName?: string
  /** Slots with no text, for the download's own warning. */
  emptySlots?: number
  onSave(): void
  /** Set when the selection is a table cell: the table's own settings show below. */
  table?: TemplateTable | null
  onRenameColumn?(key: string, name: string): void
  onResizeColumn?(key: string, width: number): void
  onAddColumn?(): void
  onRemoveColumn?(key: string): void
}) {
  const disabled = !selected || locked
  const choice = selected ? toFontChoice(selected.fontId) : null

  return (
    <TooltipProvider>
      <aside
        data-testid="inspector-panel"
        className="flex h-full w-60 shrink-0 flex-col gap-4 border-l border-border bg-background p-3"
      >
        <div className="flex items-center justify-end gap-2">
          <DownloadButton
            isRendering={isRendering}
            render={render}
            downloadBlockedReason={downloadBlockedReason}
            fileName={fileName}
            emptySlots={emptySlots}
          />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button size="sm" onClick={onSave} data-testid="panel-save">
                  <Save data-icon="inline-start" /> Save
                </Button>
              }
            />
            <TooltipContent>Keep the layout and what you typed for this file (it also saves on its own)</TooltipContent>
          </Tooltip>
        </div>

        <Separator />

        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-medium text-muted-foreground">Slot</h2>
          <NameField
            key={selected?.id ?? 'none'}
            name={name}
            disabled={!selected || nameReadOnly}
            onRename={onRename}
          />
        </section>

        <Separator />

        <section className="flex flex-col gap-2" data-testid="typography">
          <h2 className="text-xs font-medium text-muted-foreground">Typography</h2>

          <Hint label="Font family">
            <Select
              items={FONT_FAMILIES}
              value={choice?.family ?? ''}
              onValueChange={(value) => {
                if (choice) applyPatch({ fontId: toFontId(value as FontFamily, choice.weight) })
              }}
              disabled={disabled}
            >
              <SelectTrigger size="sm" className="w-full" data-testid="font-select-trigger" aria-label="Font family">
                <SelectValue placeholder="Font" />
              </SelectTrigger>
              <SelectContent>
                {FONT_FAMILIES.map((family) => (
                  <SelectItem key={family.value} value={family.value} data-testid={`font-option-${family.value}`}>
                    {family.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Hint>

          <div className="grid grid-cols-2 gap-2">
            <Hint label="Weight">
              <Select
                items={FONT_WEIGHTS}
                value={choice?.weight ?? ''}
                onValueChange={(value) => {
                  if (choice) applyPatch({ fontId: toFontId(choice.family, value as FontWeight) })
                }}
                disabled={disabled || (choice !== null && !hasBold(choice.family))}
              >
                <SelectTrigger size="sm" className="w-full" data-testid="weight-select-trigger" aria-label="Weight">
                  <SelectValue placeholder="Weight" />
                </SelectTrigger>
                <SelectContent>
                  {FONT_WEIGHTS.map((weight) => (
                    <SelectItem key={weight.value} value={weight.value} data-testid={`weight-option-${weight.value}`}>
                      {weight.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Hint>
            <Hint label="Size (points)">
              <NumberField
                aria-label="Size"
                data-testid="size-input"
                className="h-7 text-[0.8rem] tabular-nums"
                value={selected?.size ?? 12}
                min={4}
                max={200}
                onCommit={(size) => applyPatch({ size })}
                disabled={disabled}
              />
            </Hint>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Hint label="Line height (× size)">
              <NumberField
                aria-label="Line height"
                data-testid="line-height-input"
                className="h-7 text-[0.8rem] tabular-nums"
                value={selected?.lineHeight ?? 1.2}
                min={0.5}
                max={4}
                step={0.1}
                onCommit={(lineHeight) => applyPatch({ lineHeight: Math.round(lineHeight * 100) / 100 })}
                disabled={disabled}
              />
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
              disabled={disabled}
              className="w-full"
              data-testid="align-toggle-group"
            >
              <Hint label="Align left">
                <ToggleGroupItem value="left" aria-label="Align left" data-testid="align-left" size="sm">
                  <AlignLeft />
                </ToggleGroupItem>
              </Hint>
              <Hint label="Align centre">
                <ToggleGroupItem value="center" aria-label="Align center" data-testid="align-center" size="sm">
                  <AlignCenter />
                </ToggleGroupItem>
              </Hint>
              <Hint label="Align right">
                <ToggleGroupItem value="right" aria-label="Align right" data-testid="align-right" size="sm">
                  <AlignRight />
                </ToggleGroupItem>
              </Hint>
            </ToggleGroup>
          </div>

          <ColorField
            value={selected?.color ?? { r: 0, g: 0, b: 0 }}
            onChange={(color) => applyPatch({ color })}
            disabled={disabled}
          />
        </section>

        {table && (
          <TableInspector
            table={table}
            locked={locked}
            onRenameColumn={(key, columnName) => onRenameColumn?.(key, columnName)}
            onResizeColumn={(key, width) => onResizeColumn?.(key, width)}
            onAddColumn={() => onAddColumn?.()}
            onRemoveColumn={(key) => onRemoveColumn?.(key)}
          />
        )}
      </aside>
    </TooltipProvider>
  )
}

/**
 * The name, editable in place: commits on Enter or blur, Escape reverts.
 * Keyed by slot id in the parent so switching slots discards a draft.
 */
function NameField({ name, disabled, onRename }: { name: string; disabled: boolean; onRename(name: string): void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const trimmed = draft.trim()
    setDraft(null)
    if (trimmed !== '' && trimmed !== name) onRename(trimmed)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
      event.currentTarget.blur()
    } else if (event.key === 'Escape') {
      setDraft(null)
      event.currentTarget.blur()
    }
  }
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="inspector-slot-name" className="sr-only">
        Name
      </Label>
      <Input
        id="inspector-slot-name"
        data-testid="inspector-name"
        className="h-7 text-[0.8rem]"
        placeholder={disabled ? 'No slot selected' : 'Name'}
        disabled={disabled}
        value={draft ?? name}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
      />
    </div>
  )
}
