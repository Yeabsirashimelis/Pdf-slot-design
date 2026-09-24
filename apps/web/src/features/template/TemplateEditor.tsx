'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { cellName, tableIdOfCell, toLayout, toSlots, toValues, type Point, type Slot, type TableStyle } from '@pdf-slot/core'
import type { SessionStore, TemplateStore } from '@/lib/persistence/templateStore'
import { Editor, type NamingState } from '@/features/editor/Editor'
import { useEditorPipeline } from '@/features/editor/useEditorPipeline'
import { useEditorStore } from '@/features/editor/state/useEditorStore'
import type { PasteTarget } from '@/features/editor/useSlotClipboard'
import { isCell, textsOfCells } from '@/features/editor/table/tableSlots'
import { useTables, type DrawnRow } from '@/features/editor/table/useTables'
import { InspectorPanel } from '@/features/editor/panels/InspectorPanel'
import { SlotsPanel } from '@/features/editor/panels/SlotsPanel'
import { ShortcutsDialog } from '@/features/editor/panels/ShortcutsDialog'
import { copyName } from './copyName'
import { useDebouncedWrite } from './useTemplatePersistence'
import type { OpenedFile } from './openFile'

/** A slot being named in place: `isNew` means an empty name discards it, as Figma discards an empty text box. */
type Naming = { id: string; value: string; isNew: boolean }

/**
 * The one-screen shell around the workspace: the slots panel on the
 * left (list and form in one), the canvas in the middle, the inspector
 * on the right. Owns what the store does not: slot names, the slot
 * being named in place, the layout lock, and persistence. The editor
 * works on Slot[] throughout; names meet the slots only at the
 * persistence boundary (toLayout / toSlots), where the layout (geometry,
 * typography, names) and the values (text) are two records -- lay out
 * once, fill in any number of times.
 */
export function TemplateEditor({
  opened, store, onStartOver,
}: {
  opened: OpenedFile
  store: TemplateStore & SessionStore
  onStartOver(): void
}) {
  const { doc, name: fileName, fileId, layout, values } = opened
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries((layout?.slots ?? []).map((s) => [s.id, s.name])),
  )
  /** The table tool: armed by the panel, spent on the next drag over the page. */
  const [drawingTable, setDrawingTable] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  // The store holds the hand-placed slots only. A table's cells are
  // derived from the table (see useTables), so keeping them here as well
  // would leave two copies of the same geometry to drift apart -- and an
  // undo could put a cell back where its table no longer says it is.
  const editor = useEditorStore(layout ? toSlots({ ...layout, tables: [] }, values) : [])
  const tables = useTables(
    layout?.tables ?? [],
    layout ? textsOfCells(toSlots(layout, values)) : {},
  )
  // What the rest of the editor sees: both kinds of slot, and a store
  // that knows which is which. A cell's text belongs to its table, and a
  // cell cannot be moved, duplicated or deleted on its own -- the table
  // lays it out.
  const allSlots = useMemo(() => [...editor.slots, ...tables.cells], [editor.slots, tables.cells])
  const slotStore = useMemo(
    () => ({
      ...editor,
      slots: allSlots,
      updateSlot(id: string, patch: Partial<Slot>) {
        if (!isCell(id)) {
          editor.updateSlot(id, patch)
          return
        }
        if (patch.text !== undefined) tables.setCellText(id, patch.text)
        // Anything else is typography, which a table shares across every cell.
        const style = Object.fromEntries(Object.entries(patch).filter(([key]) => key !== 'text'))
        const table = tables.tableOf(id)
        if (table && Object.keys(style).length > 0) tables.setStyle(table.id, style as Partial<TableStyle>)
      },
      removeSlot(id: string) {
        if (!isCell(id)) editor.removeSlot(id)
      },
      duplicateSlot(id: string) {
        return isCell(id) ? null : editor.duplicateSlot(id)
      },
      nudgeSlot(id: string, dx: number, dy: number) {
        if (!isCell(id)) editor.nudgeSlot(id, dx, dy)
      },
    }),
    [editor, allSlots, tables],
  )
  const pipeline = useEditorPipeline(doc, slotStore)
  const [pageIndex, setPageIndex] = useState(0)
  const [locked, setLocked] = useState(false)
  const [naming, setNaming] = useState<Naming | null>(null)
  // Mirrors `naming` for the handlers: Enter commits and the input's blur
  // follows in the same tick, before React has re-rendered with the
  // cleared state, so the second call must see it already cleared.
  const namingRef = useRef<Naming | null>(null)
  const updateNaming = (next: Naming | null) => {
    namingRef.current = next
    setNaming(next)
  }
  // The slot whose text box should take the caret next: naming a slot ends
  // by focusing it, so the very next thing typed is the slot's *text* and
  // not another name. Without it the box sits there showing its name as a
  // placeholder, which reads exactly like content that would be exported --
  // and is not.
  const [focusSlotId, setFocusSlotId] = useState<string | null>(null)

  // Record which file is open, so a reload lands here again. An effect,
  // not a render-time write: a store write is a side effect React may
  // repeat if it re-runs the render.
  useEffect(() => {
    void store.put({ fileId })
  }, [fileId, store])

  // Debounced safety-net writes of both records; Save writes at once.
  const currentLayout = useMemo(
    () => toLayout(fileId, editor.slots, names, new Date().toISOString(), tables.tables),
    [fileId, editor.slots, names, tables.tables],
  )
  const currentValues = useMemo(() => toValues(fileId, allSlots, new Date().toISOString()), [fileId, allSlots])
  useDebouncedWrite(currentLayout, (l) => store.putLayout(l))
  useDebouncedWrite(currentValues, (v) => store.putValues(v))

  const handlePlaceSlot = (atPdf: Point, page: number) => {
    // A click on the page while naming another slot lands after that
    // input's blur, which has already committed it.
    const id = editor.addSlot(atPdf, page)
    updateNaming({ id, value: '', isNew: true })
  }

  const handleRemove = (id: string) => {
    pipeline.removeSlotAndCommit(id)
    setNames((n) => Object.fromEntries(Object.entries(n).filter(([key]) => key !== id)))
  }

  const handleRename = (id: string, name: string) => {
    setNames((n) => ({ ...n, [id]: name }))
  }

  const handleDuplicate = (id: string) => {
    const copyId = pipeline.duplicateSlotAndCommit(id)
    if (!copyId) return
    setNames((n) => ({ ...n, [copyId]: copyName(n[id] ?? 'Slot', Object.values(n)) }))
  }

  // Ctrl/Cmd+V and Alt+drag: a copy of a snapshot, named after the slot it
  // was copied from (which may since have been renamed or deleted).
  const handlePaste = (snapshot: Slot, label: string | undefined, target: PasteTarget): string => {
    const pastedId = pipeline.pasteSlotAndCommit(snapshot, target)
    setNames((n) => {
      // A copy needs a name of its own; a slot that was CUT has left its
      // name behind, so it simply keeps it -- the same slot, put down
      // somewhere else, not a copy of anything.
      const wanted = label ?? 'Slot'
      const taken = Object.values(n)
      return { ...n, [pastedId]: taken.includes(wanted) ? copyName(wanted, taken) : wanted }
    })
    return pastedId
  }

  const namingState: NamingState | null = naming
    ? {
        id: naming.id,
        value: naming.value,
        onChange: (value) => updateNaming({ ...naming, value }),
        onCommit: () => {
          const current = namingRef.current
          if (!current) return
          const trimmed = current.value.trim()
          updateNaming(null)
          if (trimmed === '') {
            // Nothing typed: a new slot is discarded, a rename is dropped.
            if (current.isNew) handleRemove(current.id)
            return
          }
          handleRename(current.id, trimmed)
          // Named and ready to be written into: carry the caret over, and
          // say which of the two things just happened -- naming a slot is
          // not the same as filling it in, and that is exactly the step
          // that is easy to stop at by mistake.
          setFocusSlotId(current.id)
          toast.success(current.isNew ? `Added "${trimmed}"` : `Renamed to "${trimmed}"`, {
            description: current.isNew ? 'Now type the text that goes in it.' : undefined,
          })
        },
        onCancel: () => {
          const current = namingRef.current
          if (!current) return
          updateNaming(null)
          if (current.isNew) handleRemove(current.id)
        },
      }
    : null

  const handleSave = () => {
    void Promise.all([store.putLayout(currentLayout), store.putValues(currentValues)]).then(() =>
      toast.success('Saved'),
    )
  }

  const handleStartOver = () => {
    // The user asked to leave; a storage failure must not keep them here.
    // Logged rather than surfaced: a session that failed to clear is at
    // worst re-tried on the next reload.
    void store.clear()
      .catch((err: unknown) => console.error('Failed to clear the open session', err))
      .finally(onStartOver)
  }

  const selected = allSlots.find((s) => s.id === editor.selectedId) ?? null
  const selectedTable = editor.selectedId ? tables.tableOf(editor.selectedId) : null
  // The panel lists the hand-placed slots; a table is one group of its
  // own (see TablePanel), not forty entries in this list.
  const panelSlots = editor.slots.map((s) => ({
    id: s.id,
    name: names[s.id] ?? 'Slot',
    text: s.text,
    page: s.page,
    x: s.x,
    y: s.y,
  }))
  /** A cell is named by its column and row; a hand-placed slot by its own name. */
  const nameOf = (slot: Slot | null): string => {
    if (!slot) return ''
    const table = tables.tableOf(slot.id)
    if (!table) return names[slot.id] ?? ''
    const [, rest] = slot.id.split('#')
    const [row, key] = (rest ?? '').split(':')
    const column = table.columns.find((c) => c.key === key)
    return column ? cellName(column, Number(row)) : ''
  }

  const handleDrawTableRow = (row: DrawnRow) => {
    setDrawingTable(false)
    if (row.width <= 0 || row.height <= 0) return
    const style: TableStyle = selected
      ? { fontId: selected.fontId, size: selected.size, color: selected.color, align: selected.align, lineHeight: selected.lineHeight }
      : { fontId: 'sans', size: 10, color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2 }
    const table = tables.create(row, style)
    const first = tables.firstCellOfRow(table, 0)
    if (first) editor.select(first)
    toast.success('Table added', { description: 'Split it into columns, then add rows.' })
  }

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background" data-testid="template-editor">
      <SlotsPanel
        fileName={fileName}
        slots={panelSlots}
        selectedId={editor.selectedId}
        pageIndex={pageIndex}
        pageCount={doc.pages.length}
        locked={locked}
        onLockedChange={setLocked}
        onPageChange={setPageIndex}
        onSelect={editor.select}
        onRename={handleRename}
        onRemove={handleRemove}
        onDuplicate={handleDuplicate}
        onChangeText={(id, text) => slotStore.updateSlot(id, { text })}
        onStartOver={handleStartOver}
        tables={tables.tables}
        tableTexts={Object.fromEntries(tables.cells.map((cell) => [cell.id, cell.text]))}
        drawingTable={drawingTable}
        onDrawTable={() => setDrawingTable((armed) => !armed)}
        onAddTableRow={tables.addRow}
        onRemoveTableRow={tables.removeRow}
        onRemoveTable={(id) => {
          // Nothing may stay selected in a table that no longer exists.
          if (tableIdOfCell(editor.selectedId ?? '') === id) editor.select(null)
          tables.remove(id)
        }}
        onShowShortcuts={() => setShortcutsOpen(true)}
      />
      <main className="relative min-w-0 flex-1">
        <Editor
          doc={doc}
          store={slotStore}
          pipeline={pipeline}
          pageIndex={pageIndex}
          onPageChange={setPageIndex}
          locked={locked}
          names={names}
          naming={namingState}
          focusSlotId={focusSlotId}
          onSlotFocused={() => setFocusSlotId(null)}
          onPlaceSlot={handlePlaceSlot}
          onDuplicateSlot={handleDuplicate}
          onRemoveSlot={handleRemove}
          onPasteSlot={handlePaste}
          tables={tables.tables}
          drawingTable={drawingTable}
          onDrawTableRow={handleDrawTableRow}
          onTableDrag={tables.applyDrag}
          onTableCommit={pipeline.handleCommit}
          onShowShortcuts={() => setShortcutsOpen(true)}
        />
      </main>
      <InspectorPanel
        selected={selected}
        name={nameOf(selected)}
        nameReadOnly={selectedTable !== null}
        onRename={(name) => {
          if (selected) handleRename(selected.id, name)
        }}
        applyPatch={(patch) => {
          if (selected) pipeline.updateSlotAndCommit(selected.id, patch)
        }}
        table={selectedTable}
        onRenameColumn={(key, name) => selectedTable && tables.renameColumn(selectedTable.id, key, name)}
        onResizeColumn={(key, width) => selectedTable && tables.setColumnWidth(selectedTable.id, key, width)}
        onAddColumn={() => selectedTable && tables.addColumn(selectedTable.id)}
        onRemoveColumn={(key) => selectedTable && tables.removeColumn(selectedTable.id, key)}
        locked={locked}
        isRendering={pipeline.isRendering}
        render={pipeline.render}
        downloadBlockedReason={pipeline.downloadBlockedReason}
        fileName={fileName}
        emptySlots={allSlots.filter((s) => s.text.trim() === '').length}
        onSave={handleSave}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  )
}
