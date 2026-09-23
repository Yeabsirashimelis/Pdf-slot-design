'use client'

import { Plus, Rows3, Trash2 } from 'lucide-react'
import { cellId, type TemplateTable } from '@pdf-slot/core'
import { Button } from '@/components/ui/button'
import { HintButton } from '@/components/hint'
import { cn } from '@/lib/utils'

/**
 * A table in the slots panel: one group, one line per row -- not forty
 * fields. The line previews what is written across that row, so a
 * half-filled log can be read at a glance; the cells themselves are typed
 * into on the page, where they sit on the printed lines they belong to.
 */
export function TablePanel({
  table,
  texts,
  selectedId,
  locked,
  onSelectCell,
  onAddRow,
  onRemoveRow,
}: {
  table: TemplateTable
  /** What is currently written in each cell, by slot id. */
  texts: Record<string, string>
  selectedId: string | null
  locked: boolean
  /** Jump to a row: selects its first cell, which is what the page and the inspector follow. */
  onSelectCell(id: string): void
  onAddRow(): void
  onRemoveRow(row: number): void
}) {
  const rows = Array.from({ length: table.rowCount }, (_, row) => row)
  const idsOf = (row: number) => table.columns.map((column) => cellId(table.id, row, column.key))

  return (
    <div className="flex flex-col gap-0.5" data-testid={`table-panel-${table.id}`}>
      <div className="flex items-center gap-1.5 px-2 pt-2 pb-1">
        <Rows3 className="size-3.5 shrink-0 opacity-70" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
          Table · {table.columns.length} column{table.columns.length === 1 ? '' : 's'}
        </span>
        <HintButton
          hint="Add a row below the last one, at the same spacing"
          variant="ghost"
          size="icon-xs"
          aria-label="Add row"
          data-testid={`table-add-row-${table.id}`}
          disabled={locked}
          onClick={onAddRow}
        >
          <Plus />
        </HintButton>
      </div>

      {rows.map((row) => {
        const ids = idsOf(row)
        const isSelected = selectedId !== null && ids.includes(selectedId)
        const preview = ids.map((id) => texts[id] ?? '').filter((text) => text !== '').join(' · ')
        return (
          <div
            key={row}
            role="button"
            tabIndex={0}
            aria-pressed={isSelected}
            data-testid={`table-row-${table.id}-${row}`}
            onClick={() => onSelectCell(ids[0]!)}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSelectCell(ids[0]!)
              }
            }}
            className={cn(
              'group/row flex items-center gap-1.5 rounded-md px-2 py-1 text-sm outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring',
              isSelected && 'bg-accent text-accent-foreground hover:bg-accent',
            )}
          >
            <span className="w-10 shrink-0 text-xs text-muted-foreground tabular-nums">Row {row + 1}</span>
            <span
              className={cn('min-w-0 flex-1 truncate text-xs', preview === '' && 'italic opacity-60')}
              data-testid={`table-row-preview-${table.id}-${row}`}
            >
              {preview === '' ? 'empty' : preview}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove row ${row + 1}`}
              data-testid={`table-remove-row-${table.id}-${row}`}
              disabled={locked || table.rowCount <= 1}
              className={cn('shrink-0 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100', isSelected && 'opacity-100')}
              onClick={(event) => {
                event.stopPropagation()
                onRemoveRow(row)
              }}
            >
              <Trash2 />
            </Button>
          </div>
        )
      })}
    </div>
  )
}
