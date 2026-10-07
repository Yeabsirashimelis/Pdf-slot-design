'use client'

import { useState, type KeyboardEvent } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { MIN_COLUMN_WIDTH, type TemplateTable } from '@pdf-slot/core'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { HintButton } from '@/components/hint'
import { NumberField } from '../panels/NumberField'

/**
 * The selected table's own settings: its columns (name and width), how
 * tall a row is and how far apart the rows sit. The same numbers the
 * handles on the page set -- typed here when a printed table's
 * measurements are known, dragged there when they are not.
 */
export function TableInspector({
  table,
  locked = false,
  onRename,
  onRenameColumn,
  onResizeColumn,
  onAddColumn,
  onRemoveColumn,
}: {
  table: TemplateTable
  locked?: boolean
  /** The name a data file addresses this table by. */
  onRename(name: string): void
  onRenameColumn(key: string, name: string): void
  onResizeColumn(key: string, width: number): void
  /** Splits the last column in two, so the columns already set keep their widths. */
  onAddColumn(): void
  onRemoveColumn(key: string): void
}) {
  return (
    <>
      <Separator />
      <section className="flex flex-col gap-2" data-testid="table-inspector">
        {/* The name first, because it is the one thing about a table that
            has to be known outside the editor: a data file addresses its
            rows by it, exactly as it addresses a slot by that slot's name. */}
        <h2 className="text-xs font-medium text-muted-foreground">Table name</h2>
        <EditableName
          key={table.name}
          label="Table name"
          name={table.name}
          disabled={locked}
          testId="table-name"
          onRename={onRename}
        />

        <div className="flex items-center gap-1.5">
          <h2 className="flex-1 text-xs font-medium text-muted-foreground">Columns</h2>
          <HintButton
            hint="Split the last column in two"
            variant="ghost"
            size="icon-xs"
            aria-label="Add column"
            data-testid="table-add-column"
            disabled={locked}
            onClick={onAddColumn}
          >
            <Plus />
          </HintButton>
        </div>

        {table.columns.map((column) => (
          <div key={column.key} className="flex items-center gap-1.5">
            <EditableName
              key={`${column.key}:${column.name}`}
              label="Column name"
              name={column.name}
              disabled={locked}
              testId={`table-column-name-${column.key}`}
              onRename={(name) => onRenameColumn(column.key, name)}
            />
            <NumberField
              aria-label={`${column.name} width`}
              data-testid={`table-column-width-${column.key}`}
              className="h-7 w-14 text-[0.8rem] tabular-nums"
              value={Math.round(column.width)}
              min={MIN_COLUMN_WIDTH}
              max={2000}
              onCommit={(width) => onResizeColumn(column.key, width)}
              disabled={locked}
            />
            <HintButton
              hint="Remove this column"
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove ${column.name}`}
              data-testid={`table-remove-column-${column.key}`}
              disabled={locked || table.columns.length <= 1}
              onClick={() => onRemoveColumn(column.key)}
            >
              <Trash2 />
            </HintButton>
          </div>
        ))}

      </section>
    </>
  )
}

/** A name typed into the panel: committed on Enter or blur, reverted on Escape. */
function EditableName({
  label,
  name,
  disabled,
  testId,
  onRename,
}: {
  label: string
  name: string
  disabled: boolean
  testId: string
  onRename(name: string): void
}) {
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
    <Input
      aria-label={label}
      data-testid={testId}
      className="h-7 min-w-0 flex-1 text-[0.8rem]"
      value={draft ?? name}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
    />
  )
}
