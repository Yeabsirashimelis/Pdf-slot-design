'use client'

import { useState, type KeyboardEvent } from 'react'
import { ArrowLeft, Copy, Keyboard, Lock, LockOpen, Table, Trash2, Type } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { Toggle } from '@/components/ui/toggle'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { HintButton } from '@/components/hint'
import { cn } from '@/lib/utils'
import { groupByPage } from '@/features/template/readingOrder'
import { TablePanel } from '@/features/editor/table/TablePanel'
import { SHORTCUTS_KEY } from './ShortcutsDialog'
import type { TemplateTable } from '@pdf-slot/core'

export type PanelSlot = { id: string; name: string; text: string; page: number; x: number; y: number }

/**
 * The left column: the file, then every slot as a row that is both the
 * list entry and the form field -- the name (double-click to rename) and
 * a value box that writes straight onto the page (see TemplateEditor:
 * field text and on-page text are one state). Rows are in reading order,
 * grouped by page when there is more than one; clicking a row on another
 * page jumps there. The padlock freezes the layout so filling in the
 * form cannot nudge a box.
 */
export function SlotsPanel({
  fileName,
  slots,
  selectedId,
  pageIndex,
  pageCount,
  locked,
  onLockedChange,
  onPageChange,
  onSelect,
  onRename,
  onRemove,
  onDuplicate,
  onChangeText,
  onStartOver,
  tables = [],
  tableTexts = {},
  drawingTable = false,
  onDrawTable,
  onAddTableRow,
  onRemoveTableRow,
  onShowShortcuts,
}: {
  fileName: string
  slots: PanelSlot[]
  selectedId: string | null
  /** The page the workspace is showing. */
  pageIndex: number
  pageCount: number
  locked: boolean
  onLockedChange(locked: boolean): void
  onPageChange(page: number): void
  onSelect(id: string): void
  onRename(id: string, name: string): void
  onRemove(id: string): void
  onDuplicate(id: string): void
  onChangeText(id: string, text: string): void
  /** Back to the file list. */
  onStartOver(): void
  /** Table row slots on this file: one group each, rather than a line per cell. */
  tables?: TemplateTable[]
  tableTexts?: Record<string, string>
  /** True while the next drag on the page will draw a table's first row. */
  drawingTable?: boolean
  onDrawTable?(): void
  onAddTableRow?(id: string): void
  onRemoveTableRow?(id: string, row: number): void
  /** Opens the list of commands. The panel only says which key does it. */
  onShowShortcuts?(): void
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const groups = groupByPage(slots)

  const goTo = (slot: PanelSlot) => {
    onSelect(slot.id)
    if (slot.page !== pageIndex) onPageChange(slot.page)
  }

  const row = (slot: PanelSlot) => {
    const isSelected = selectedId === slot.id
    return (
      /* Not a shadcn Button: the row holds buttons and a field, and a
         button must not contain another. A div plays the role instead,
         made focusable and keyboard-operable by hand (Enter/Space select). */
      <div
        key={slot.id}
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
        data-testid={`slot-row-${slot.id}`}
        data-selected={isSelected}
        onClick={() => goTo(slot)}
        onKeyDown={(e) => {
          // Keys on the nested controls are their own (they bubble up here).
          if (e.target !== e.currentTarget) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            goTo(slot)
          }
        }}
        className={cn(
          'group/row flex flex-col gap-1.5 rounded-md px-2 py-1.5 outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring',
          isSelected && 'bg-accent text-accent-foreground hover:bg-accent',
        )}
      >
        <div className="flex h-6 items-center gap-1.5">
          <Type className="size-3.5 shrink-0 opacity-70" aria-hidden />
          {renamingId === slot.id ? (
            <RenameField
              name={slot.name}
              onDone={(name) => {
                setRenamingId(null)
                if (name !== null) onRename(slot.id, name)
              }}
            />
          ) : (
            <span
              className="min-w-0 flex-1 truncate text-sm"
              data-testid={`slot-name-${slot.id}`}
              onDoubleClick={(e) => {
                e.stopPropagation()
                setRenamingId(slot.id)
              }}
              title="Double-click to rename"
            >
              {slot.name}
            </span>
          )}
          <div className={cn('flex shrink-0 items-center opacity-0 group-hover/row:opacity-100 focus-within:opacity-100', isSelected && 'opacity-100')}>
            <HintButton
              hint="Duplicate with the same settings"
              variant="ghost"
              size="icon-xs"
              aria-label={`Duplicate ${slot.name}`}
              data-testid={`slot-duplicate-${slot.id}`}
              disabled={locked}
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
              data-testid={`slot-remove-${slot.id}`}
              disabled={locked}
              onClick={(e) => {
                e.stopPropagation()
                onRemove(slot.id)
              }}
            >
              <Trash2 />
            </HintButton>
          </div>
        </div>
        {/* A textarea, not an Input: slot text can span lines (the on-page
            box is a textarea too) and <input type=text> silently drops
            every newline. One row tall by default; grows with content. */}
        <Textarea
          aria-label={slot.name}
          data-testid={`slot-field-${slot.id}`}
          rows={1}
          placeholder="Empty"
          className="min-h-7 bg-background/60 py-1 text-sm dark:bg-background/60"
          value={slot.text}
          onFocus={() => goTo(slot)}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onChangeText(slot.id, e.target.value)}
        />
      </div>
    )
  }

  return (
    <TooltipProvider>
      <aside
        data-testid="slot-panel"
        className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-background"
      >
        <div className="flex items-center gap-1 border-b border-border px-2 py-2">
          <HintButton
            hint="Close this file and go back to your files. Everything is kept."
            variant="ghost"
            size="icon-sm"
            aria-label="All files"
            data-testid="start-over-button"
            onClick={onStartOver}
          >
            <ArrowLeft />
          </HintButton>
          <span className="min-w-0 flex-1 truncate text-sm" title={fileName} data-testid="file-name">
            {fileName}
          </span>
        </div>

        <div className="flex items-center justify-between px-3 pt-3 pb-1">
          <h2 className="text-sm font-medium">Slots</h2>
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  size="sm"
                  aria-label="Add a table"
                  data-testid="table-tool"
                  pressed={drawingTable}
                  disabled={locked}
                  onPressedChange={() => onDrawTable?.()}
                >
                  <Table />
                </Toggle>
              }
            />
            <TooltipContent>
              {drawingTable ? 'Drag over the first row of the table' : 'Draw a table: mark its first row, then add rows'}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  size="sm"
                  aria-label={locked ? 'Unlock the layout' : 'Lock the layout'}
                  data-testid="lock-toggle"
                  pressed={locked}
                  onPressedChange={(pressed) => onLockedChange(pressed)}
                >
                  {locked ? <Lock /> : <LockOpen />}
                </Toggle>
              }
            />
            <TooltipContent>
              {locked ? 'Layout locked: boxes stay put while you fill them in' : 'Lock the layout so filling in cannot move a box'}
            </TooltipContent>
          </Tooltip>
        </div>

        <ScrollArea className="min-h-0 flex-1 px-2">
          <div className="flex flex-col gap-0.5 pb-2">
            {tables.map((table) => (
              <TablePanel
                key={table.id}
                table={table}
                texts={tableTexts}
                selectedId={selectedId}
                locked={locked}
                onSelectCell={(id) => {
                  onSelect(id)
                  if (table.page !== pageIndex) onPageChange(table.page)
                }}
                onAddRow={() => onAddTableRow?.(table.id)}
                onRemoveRow={(row) => onRemoveTableRow?.(table.id, row)}
              />
            ))}
            {slots.length === 0 && tables.length === 0 && (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground" data-testid="empty-hint">
                Click anywhere on the page to add a slot.
              </p>
            )}
            {groups.map((group) => (
              <div key={group.page} className="flex flex-col gap-0.5" data-testid={`page-group-${group.page}`}>
                {pageCount > 1 && (
                  <button
                    type="button"
                    className={cn(
                      'mt-2 px-2 py-1 text-left text-xs font-medium text-muted-foreground hover:text-foreground',
                      group.page === pageIndex && 'text-foreground',
                    )}
                    onClick={() => onPageChange(group.page)}
                    data-testid={`page-group-trigger-${group.page}`}
                  >
                    Page {group.page + 1}
                  </button>
                )}
                {group.slots.map(row)}
              </div>
            ))}
          </div>
        </ScrollArea>

        <button
          type="button"
          data-testid="shortcuts-button"
          onClick={() => onShowShortcuts?.()}
          className="flex w-full items-center gap-1.5 border-t border-border px-3 py-2 text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Keyboard className="size-3.5 shrink-0" aria-hidden />
          Shortcuts
          <Kbd className="ml-auto">{SHORTCUTS_KEY}</Kbd>
        </button>
      </aside>
    </TooltipProvider>
  )
}

/** The in-row rename box: Enter/blur keep, Escape reverts; empty is a revert too. */
function RenameField({ name, onDone }: { name: string; onDone(name: string | null): void }) {
  const [draft, setDraft] = useState(name)
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      const trimmed = draft.trim()
      onDone(trimmed === '' ? null : trimmed)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onDone(null)
    }
  }
  return (
    <Input
      autoFocus
      aria-label="Rename slot"
      data-testid="slot-rename-input"
      className="h-6 flex-1 px-1.5 text-sm"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => {
        const trimmed = draft.trim()
        onDone(trimmed === '' ? null : trimmed)
      }}
      onClick={(e) => e.stopPropagation()}
    />
  )
}
