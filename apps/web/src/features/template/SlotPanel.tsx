'use client'

import { useState } from 'react'
import { ArrowLeft, ArrowRight, ChevronRight, Copy, X } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { TooltipProvider } from '@/components/ui/tooltip'
import { HintButton } from '@/components/hint'
import { cn } from '@/lib/utils'
import type { Step } from '@/lib/persistence/templateStore'
import { groupByPage, type PageGroup } from './readingOrder'

export type PanelSlot = { id: string; name: string; text: string; page: number; x: number; y: number }

/**
 * The left column, grouped by page. Step 1 lists the slots as chips
 * (select / rename / duplicate / remove) with Next; step 2 turns the same
 * list into a form -- one field per slot, labelled by its name -- with
 * Back and Save. Within a page, slots are in reading order (top to
 * bottom, left to right), which is also the Tab order. Field text and
 * on-page slot text are one state (see TemplateEditor).
 *
 * One page group is open at a time by default: the page being shown.
 * Changing pages opens that page's group and closes the rest; the user
 * can then open or close any group freely until the next page change.
 * Clicking a chip or focusing a field on another page jumps to it.
 */
export function SlotPanel({
  step,
  slots,
  selectedId,
  pageIndex,
  onPageChange,
  onSelect,
  onRename,
  onRemove,
  onDuplicate,
  onNext,
  onBack,
  onChangeText,
  onSave,
}: {
  step: Step
  slots: PanelSlot[]
  selectedId: string | null
  /** The page the editor is showing; its group is the one open by default. */
  pageIndex: number
  onPageChange(page: number): void
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
  // Which page groups are open. Reset to "just the current page" whenever
  // the page changes -- adjusted during render (React's documented pattern
  // for deriving state from a prop change) rather than in an effect.
  const [openPages, setOpenPages] = useState<ReadonlySet<number>>(() => new Set([pageIndex]))
  const [openedForPage, setOpenedForPage] = useState(pageIndex)
  if (openedForPage !== pageIndex) {
    setOpenedForPage(pageIndex)
    setOpenPages(new Set([pageIndex]))
  }
  const togglePage = (page: number, open: boolean) => {
    setOpenPages((current) => {
      const next = new Set(current)
      if (open) next.add(page)
      else next.delete(page)
      return next
    })
  }

  // The page being shown always has a group, even with no slots yet.
  const groups: PageGroup<PanelSlot>[] = groupByPage(slots)
  if (!groups.some((g) => g.page === pageIndex)) {
    groups.push({ page: pageIndex, slots: [] })
    groups.sort((a, b) => a.page - b.page)
  }

  const goTo = (slot: PanelSlot) => {
    onSelect(slot.id)
    if (slot.page !== pageIndex) onPageChange(slot.page)
  }

  const renderGroup = (group: PageGroup<PanelSlot>, renderSlot: (slot: PanelSlot) => React.ReactNode) => (
    <Collapsible
      key={group.page}
      open={openPages.has(group.page)}
      onOpenChange={(open) => togglePage(group.page, open)}
      data-testid={`page-group-${group.page}`}
    >
      <CollapsibleTrigger
        data-testid={`page-group-trigger-${group.page}`}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md py-1 text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
          group.page === pageIndex && 'text-foreground',
        )}
      >
        <ChevronRight className="size-3.5 transition-transform in-data-[panel-open]:rotate-90" aria-hidden />
        Page {group.page + 1}
        <span className="ml-auto font-normal tabular-nums">
          {group.slots.length === 0 ? 'no slots yet' : `${group.slots.length} slot${group.slots.length === 1 ? '' : 's'}`}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-1.5 pt-1 pb-2">
        {group.slots.map(renderSlot)}
      </CollapsibleContent>
    </Collapsible>
  )

  const chip = (slot: PanelSlot) => (
    /* Not a shadcn Button: the chip contains the ✕ Button, and a button
       must not contain another. A div plays the role instead, made
       focusable and keyboard-operable by hand (Enter/Space select). */
    <div
      key={slot.id}
      role="button"
      tabIndex={0}
      aria-pressed={selectedId === slot.id}
      data-testid={`slot-chip-${slot.id}`}
      data-selected={selectedId === slot.id}
      onClick={() => goTo(slot)}
      onDoubleClick={() => onRename(slot.id)}
      onKeyDown={(e) => {
        // Keys on the nested buttons are their own (they bubble up here).
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          goTo(slot)
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
        onClick={(e) => {
          e.stopPropagation()
          onDuplicate(slot.id)
        }}
      >
        <Copy />
      </HintButton>
      <HintButton
        hint="Remove this slot from the page"
        variant="ghost"
        size="icon-xs"
        aria-label={`Remove ${slot.name}`}
        data-testid={`slot-chip-remove-${slot.id}`}
        onClick={(e) => {
          e.stopPropagation()
          onRemove(slot.id)
        }}
      >
        <X />
      </HintButton>
    </div>
  )

  const field = (slot: PanelSlot) => (
    <div key={slot.id} className="grid gap-1.5">
      <Label htmlFor={`slot-field-${slot.id}`}>{slot.name}</Label>
      {/* A textarea, not an Input: slot text can span lines (the on-page
          box is a textarea too) and <input type=text> silently drops
          every newline. One row tall by default; grows with content. */}
      <Textarea
        id={`slot-field-${slot.id}`}
        data-testid={`slot-field-${slot.id}`}
        rows={1}
        className="min-h-8 py-1"
        value={slot.text}
        onFocus={() => goTo(slot)}
        onChange={(e) => onChangeText(slot.id, e.target.value)}
      />
    </div>
  )

  return (
    <TooltipProvider>
      <aside
        data-testid="slot-panel"
        className="sticky top-4 flex max-h-[calc(100dvh-2rem)] w-72 shrink-0 flex-col gap-4 rounded-lg border border-border bg-muted p-4"
      >
        {step === 'layout' ? (
          <div>
            <h2 className="text-sm font-medium">Slots</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Click the page to add a slot. Drag to move, use the toolbar to style.
            </p>
          </div>
        ) : (
          <>
            <HintButton
              hint="Go back to move, resize or restyle the slots"
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={onBack}
              data-testid="panel-back"
            >
              <ArrowLeft /> Back
            </HintButton>
            <h2 className="text-sm font-medium">Form</h2>
          </>
        )}

        {/* The list scrolls on its own when it outgrows the viewport; the
            heading above and the actions below stay put. */}
        <ScrollArea className="-mx-1 min-h-0 flex-1 px-1">
          <div className="flex flex-col gap-1 pr-3">{groups.map((g) => renderGroup(g, step === 'layout' ? chip : field))}</div>
        </ScrollArea>

        {step === 'layout' ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground" data-testid="shortcut-hints">
              Shortcuts:{' '}
              <KbdGroup>
                <Kbd>Ctrl</Kbd>
                <Kbd>Z</Kbd>
              </KbdGroup>{' '}
              undo ·{' '}
              <KbdGroup>
                <Kbd>Ctrl</Kbd>
                <Kbd>Shift</Kbd>
                <Kbd>Z</Kbd>
              </KbdGroup>{' '}
              redo ·{' '}
              <KbdGroup>
                <Kbd>Ctrl</Kbd>
                <Kbd>D</Kbd>
              </KbdGroup>{' '}
              duplicate · arrows nudge (Shift = 10pt) · double-click a chip to rename
            </p>
            <HintButton
              hint="Save the layout and start writing into the slots"
              onClick={onNext}
              disabled={slots.length === 0}
              data-testid="panel-next"
            >
              Next <ArrowRight />
            </HintButton>
          </div>
        ) : (
          <HintButton
            hint="Keep what you typed for this file (it also saves on its own as you type)"
            onClick={onSave}
            data-testid="panel-save"
          >
            Save
          </HintButton>
        )}
      </aside>
    </TooltipProvider>
  )
}
