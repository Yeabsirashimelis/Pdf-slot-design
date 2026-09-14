'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { toLayout, toSlots, toValues, type Point } from '@pdf-slot/core'
import type { SessionStore, Step, TemplateStore } from '@/lib/persistence/templateStore'
import { Editor } from '@/features/editor/Editor'
import { useEditorStore } from '@/features/editor/state/useEditorStore'
import { copyName } from './copyName'
import { NameSlotDialog } from './NameSlotDialog'
import { SlotPanel } from './SlotPanel'
import { useDebouncedWrite } from './useTemplatePersistence'
import type { OpenedFile } from './openFile'

type Pending =
  | { kind: 'place'; atPdf: Point; page: number }
  | { kind: 'rename'; id: string }
  | null

/**
 * The two-step shell around the editor.
 *
 * Step 1 (layout): place, name, move, style, delete slots. Step 2 (write):
 * the same slots, locked, with a form beside them. The editor works on
 * Slot[] throughout; names live here and meet the slots only at the
 * persistence boundary (toLayout / toSlots). Entering a step replaces the
 * slot list (a boundary undo must not cross); step 1's sample text is
 * dropped on Next, step 2's typed text is kept across Back/Next.
 */
export function TemplateEditor({
  opened, store, onStartOver,
}: {
  opened: OpenedFile
  store: TemplateStore & SessionStore
  onStartOver(): void
}) {
  const { doc, fileId, layout, values } = opened
  const [step, setStep] = useState<Step>(opened.step)
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries((layout?.slots ?? []).map((s) => [s.id, s.name])),
  )
  const editor = useEditorStore(layout ? toSlots(layout, opened.step === 'write' ? values : null) : [])
  const [pending, setPending] = useState<Pending>(null)
  // Lifted out of Editor so the panel can jump to a slot's page.
  const [pageIndex, setPageIndex] = useState(0)

  // Record which file/step is open, so a reload lands here again. An
  // effect, not a render-time write: a store write is a side effect React
  // may repeat if it re-runs the render.
  useEffect(() => {
    void store.put({ fileId, step })
  }, [fileId, step, store])

  // Debounced safety-net writes; Next/Save/Back write immediately below.
  const currentLayout = useMemo(
    () => toLayout(fileId, editor.slots, names, new Date().toISOString()),
    [fileId, editor.slots, names],
  )
  const currentValues = useMemo(() => toValues(fileId, editor.slots, new Date().toISOString()), [fileId, editor.slots])
  useDebouncedWrite(step === 'layout' ? currentLayout : null, async (l) => { if (l) await store.putLayout(l) })
  useDebouncedWrite(step === 'write' ? currentValues : null, async (v) => { if (v) await store.putValues(v) })

  // Text typed in step 2, kept so Back -> Next restores it. Only ever
  // touched inside event handlers (Back writes, Next reads), so a ref
  // rather than state.
  const writtenRef = useRef<Record<string, string>>({})

  const handlePlaceSlot = useCallback((atPdf: Point, page: number) => {
    setPending({ kind: 'place', atPdf, page })
  }, [])

  const handleNameSubmit = (name: string) => {
    if (!pending) return
    if (pending.kind === 'place') {
      const id = editor.addSlot(pending.atPdf, pending.page)
      setNames((n) => ({ ...n, [id]: name }))
    } else {
      setNames((n) => ({ ...n, [pending.id]: name }))
    }
    setPending(null)
  }

  const handleDuplicate = (id: string) => {
    const copyId = editor.duplicateSlot(id)
    if (!copyId) return
    setNames((n) => ({ ...n, [copyId]: copyName(n[id] ?? 'Slot', Object.values(n)) }))
  }

  const handleRemove = (id: string) => {
    editor.removeSlot(id)
    setNames((n) => Object.fromEntries(Object.entries(n).filter(([key]) => key !== id)))
  }

  const handleNext = () => {
    void store.putLayout(currentLayout)
    // Step 1 text is sample text, not a value. Step 2 starts from what the
    // user typed most recently in this session (including a field they
    // cleared), else from what was loaded, never from the sample.
    editor.replaceSlots(editor.slots.map((s) => ({ ...s, text: writtenRef.current[s.id] ?? values?.values[s.id] ?? '' })))
    setStep('write')
  }

  const handleBack = () => {
    void store.putValues(currentValues)
    // The full id -> text map, empty strings included, so a cleared field
    // stays cleared when the user comes forward again.
    writtenRef.current = Object.fromEntries(editor.slots.map((s) => [s.id, s.text]))
    editor.replaceSlots(editor.slots)
    setStep('layout')
  }

  const handleSave = () => {
    void store.putValues(currentValues).then(() => toast.success('Saved'))
  }

  const handleStartOver = () => {
    // The user asked to leave; a storage failure must not keep them here.
    // Logged rather than surfaced: a session that failed to clear is at
    // worst re-tried on the next reload.
    void store.clear()
      .catch((err: unknown) => console.error('Failed to clear the open session', err))
      .finally(onStartOver)
  }

  const panelSlots = editor.slots.map((s) => ({
    id: s.id,
    name: names[s.id] ?? 'Slot',
    text: s.text,
    page: s.page,
    x: s.x,
    y: s.y,
  }))

  return (
    <div className="flex items-start gap-6">
      <SlotPanel
        step={step}
        slots={panelSlots}
        pageIndex={pageIndex}
        onPageChange={setPageIndex}
        selectedId={editor.selectedId}
        onSelect={editor.select}
        onRename={(id) => setPending({ kind: 'rename', id })}
        onRemove={handleRemove}
        onDuplicate={handleDuplicate}
        onNext={handleNext}
        onBack={handleBack}
        onChangeText={(id, text) => editor.updateSlot(id, { text })}
        onSave={handleSave}
      />
      <Editor
        doc={doc}
        store={editor}
        locked={step === 'write'}
        highlighted={step === 'write'}
        onPlaceSlot={step === 'layout' ? handlePlaceSlot : undefined}
        onDuplicateSlot={handleDuplicate}
        slotLabels={names}
        pageIndex={pageIndex}
        onPageChange={setPageIndex}
        onStartOver={handleStartOver}
      />
      <NameSlotDialog
        open={pending !== null}
        initialName={pending?.kind === 'rename' ? names[pending.id] : ''}
        onSubmit={handleNameSubmit}
        onCancel={() => setPending(null)}
      />
    </div>
  )
}
