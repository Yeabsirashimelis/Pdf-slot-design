'use client'

import { ArrowLeft, ArrowRight, Copy, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { Step } from '@/lib/persistence/templateStore'

export type PanelSlot = { id: string; name: string; text: string }

/** A button with a faint hover hint; every control in the panel has one. */
function HintButton({ hint, ...button }: { hint: React.ReactNode } & React.ComponentProps<typeof Button>) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button {...button} />} />
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The left column. Step 1 lists the slots as chips (select / rename /
 * remove) with Next; step 2 turns the same list into a form -- one field
 * per slot, labelled by its name -- with Back and Save. Field text and
 * on-page slot text are one state (see TemplateEditor), so typing here
 * shows on the page immediately.
 */
export function SlotPanel({
  step, slots, selectedId, onSelect, onRename, onRemove, onDuplicate, onNext, onBack, onChangeText, onSave,
}: {
  step: Step
  slots: PanelSlot[]
  selectedId: string | null
  onSelect(id: string): void
  onRename(id: string): void
  onRemove(id: string): void
  /** Step 1: add a copy of the slot with the same settings. */
  onDuplicate(id: string): void
  onNext(): void
  onBack(): void
  onChangeText(id: string, text: string): void
  onSave(): void
}) {
  return (
    <TooltipProvider>
    <aside
      data-testid="slot-panel"
      className="flex w-72 shrink-0 flex-col gap-4 rounded-lg border border-border bg-muted p-4"
    >
      {step === 'layout' ? (
        <>
          <div>
            <h2 className="text-sm font-medium">Slots</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Click the page to add a slot. Drag to move, use the toolbar to style.
            </p>
          </div>
          <ul className="flex flex-col gap-1.5">
            {slots.map((slot) => (
              <li key={slot.id}>
                {/* Not a shadcn Button: the chip contains the ✕ Button, and a
                    button must not contain another. A div plays the role
                    instead, made focusable and keyboard-operable by hand
                    (Enter/Space select, as a native button would). */}
                <div
                  role="button"
                  tabIndex={0}
                  aria-pressed={selectedId === slot.id}
                  data-testid={`slot-chip-${slot.id}`}
                  data-selected={selectedId === slot.id}
                  onClick={() => onSelect(slot.id)}
                  onDoubleClick={() => onRename(slot.id)}
                  onKeyDown={(e) => {
                    // Keys on the nested ✕ are its own (they bubble up here).
                    if (e.target !== e.currentTarget) return
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelect(slot.id)
                    }
                  }}
                  className={cn(
                    'flex items-center gap-1 rounded-md border border-border bg-card py-1.5 pr-1 pl-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    selectedId === slot.id && 'ring-2 ring-ring',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{slot.name}</span>
                  <HintButton
                    hint="Duplicate with the same settings"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Duplicate ${slot.name}`}
                    data-testid={`slot-chip-duplicate-${slot.id}`}
                    onClick={(e) => { e.stopPropagation(); onDuplicate(slot.id) }}
                  >
                    <Copy />
                  </HintButton>
                  <HintButton
                    hint="Remove this slot from the page"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove ${slot.name}`}
                    data-testid={`slot-chip-remove-${slot.id}`}
                    onClick={(e) => { e.stopPropagation(); onRemove(slot.id) }}
                  >
                    <X />
                  </HintButton>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-auto flex flex-col gap-3">
            <p className="text-xs text-muted-foreground" data-testid="shortcut-hints">
              Shortcuts:{' '}
              <KbdGroup><Kbd>Ctrl</Kbd><Kbd>Z</Kbd></KbdGroup> undo ·{' '}
              <KbdGroup><Kbd>Ctrl</Kbd><Kbd>Shift</Kbd><Kbd>Z</Kbd></KbdGroup> redo ·{' '}
              <KbdGroup><Kbd>Ctrl</Kbd><Kbd>D</Kbd></KbdGroup> duplicate · double-click a chip to rename
            </p>
            <HintButton hint="Save the layout and start writing into the slots" onClick={onNext} disabled={slots.length === 0} data-testid="panel-next">
              Next <ArrowRight />
            </HintButton>
          </div>
        </>
      ) : (
        <>
          <HintButton hint="Go back to move, resize or restyle the slots" variant="ghost" size="sm" className="self-start" onClick={onBack} data-testid="panel-back">
            <ArrowLeft /> Back
          </HintButton>
          <h2 className="text-sm font-medium">Form</h2>
          <div className="flex flex-col gap-3">
            {slots.map((slot) => (
              <div key={slot.id} className="grid gap-1.5">
                <Label htmlFor={`slot-field-${slot.id}`}>{slot.name}</Label>
                {/* A textarea, not an Input: slot text can span lines (the
                    on-page box is a textarea too) and <input type=text>
                    silently drops every newline it is given. One row tall
                    by default; field-sizing grows it with the content. */}
                <Textarea
                  id={`slot-field-${slot.id}`}
                  data-testid={`slot-field-${slot.id}`}
                  rows={1}
                  className="min-h-8 py-1"
                  value={slot.text}
                  onFocus={() => onSelect(slot.id)}
                  onChange={(e) => onChangeText(slot.id, e.target.value)}
                />
              </div>
            ))}
          </div>
          <HintButton hint="Keep what you typed for this file (it also saves on its own as you type)" className="mt-auto" onClick={onSave} data-testid="panel-save">
            Save
          </HintButton>
        </>
      )}
    </aside>
    </TooltipProvider>
  )
}
