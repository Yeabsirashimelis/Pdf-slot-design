'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { toLayout, toSlots, toValues, type Point, type Slot } from '@pdf-slot/core'
import type { SessionStore, TemplateStore } from '@/lib/persistence/templateStore'
import { Editor, type NamingState } from '@/features/editor/Editor'
import { useEditorPipeline } from '@/features/editor/useEditorPipeline'
import { useEditorStore } from '@/features/editor/state/useEditorStore'
import type { PasteTarget } from '@/features/editor/useSlotClipboard'
import { InspectorPanel } from '@/features/editor/panels/InspectorPanel'
import { SlotsPanel } from '@/features/editor/panels/SlotsPanel'
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
  const editor = useEditorStore(layout ? toSlots(layout, values) : [])
  const pipeline = useEditorPipeline(doc, editor)
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

  // Record which file is open, so a reload lands here again. An effect,
  // not a render-time write: a store write is a side effect React may
  // repeat if it re-runs the render.
  useEffect(() => {
    void store.put({ fileId })
  }, [fileId, store])

  // Debounced safety-net writes of both records; Save writes at once.
  const currentLayout = useMemo(
    () => toLayout(fileId, editor.slots, names, new Date().toISOString()),
    [fileId, editor.slots, names],
  )
  const currentValues = useMemo(() => toValues(fileId, editor.slots, new Date().toISOString()), [fileId, editor.slots])
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
    setNames((n) => ({ ...n, [pastedId]: copyName(label ?? 'Slot', Object.values(n)) }))
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

  const selected = editor.slots.find((s) => s.id === editor.selectedId) ?? null
  const panelSlots = editor.slots.map((s) => ({
    id: s.id,
    name: names[s.id] ?? 'Slot',
    text: s.text,
    page: s.page,
    x: s.x,
    y: s.y,
  }))

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
        onChangeText={(id, text) => editor.updateSlot(id, { text })}
        onStartOver={handleStartOver}
      />
      <main className="relative min-w-0 flex-1">
        <Editor
          doc={doc}
          store={editor}
          pipeline={pipeline}
          pageIndex={pageIndex}
          onPageChange={setPageIndex}
          locked={locked}
          names={names}
          naming={namingState}
          onPlaceSlot={handlePlaceSlot}
          onDuplicateSlot={handleDuplicate}
          onRemoveSlot={handleRemove}
          onPasteSlot={handlePaste}
        />
      </main>
      <InspectorPanel
        selected={selected}
        name={selected ? (names[selected.id] ?? '') : ''}
        onRename={(name) => {
          if (selected) handleRename(selected.id, name)
        }}
        applyPatch={(patch) => {
          if (selected) pipeline.updateSlotAndCommit(selected.id, patch)
        }}
        locked={locked}
        isRendering={pipeline.isRendering}
        render={pipeline.render}
        downloadBlockedReason={pipeline.downloadBlockedReason}
        fileName={fileName}
        onSave={handleSave}
      />
    </div>
  )
}
