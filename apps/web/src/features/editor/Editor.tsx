'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  FONT_IDS,
  createFontMetrics,
  toPdfPoint,
  type EditorDocument,
  type FontId,
  type FontMetrics,
  type Viewport,
} from '@pdf-slot/core'
import { loadFontBytes, registerFontFaces } from '@/lib/fonts/loadFonts'
import { PageCanvas } from './canvas/PageCanvas'
import type { LogicalPoint } from './canvas/coordinates'
import { useEditorStore } from './state/useEditorStore'
import { SlotOverlay } from './overlay/SlotOverlay'

/** Metrics for every bundled face, built once the font bytes are loaded. */
function useFontMetrics(): Record<FontId, FontMetrics> | null {
  const [metrics, setMetrics] = useState<Record<FontId, FontMetrics> | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const bytes = await loadFontBytes()
      // Registers the very same bytes as CSS @font-face rules, so
      // SlotLines' fontFamily and this hook's widthOfText() can never
      // disagree about which glyphs they mean.
      await registerFontFaces(bytes)
      if (cancelled) return
      const entries = FONT_IDS.map((id) => [id, createFontMetrics(bytes[id])] as const)
      setMetrics(Object.fromEntries(entries) as Record<FontId, FontMetrics>)
    })().catch((err) => {
      if (!cancelled) console.error('Failed to load editor fonts', err)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return metrics
}

export function Editor({ doc, zoom = 1 }: { doc: EditorDocument; zoom?: number }) {
  const [pageIndex] = useState(0)
  const store = useEditorStore()
  const fontMetrics = useFontMetrics()

  // Set right before a canvas click creates a new slot, so the SlotOverlay
  // that mounts for it knows to grab focus once. addSlot() itself returns
  // void (per the brief's interface) and doesn't hand back the new slot's
  // id, so this is what connects "a slot was just created" to "focus it":
  // the store also auto-selects a newly added slot, so the next slot whose
  // id matches store.selectedId while this flag is set is the one to focus.
  const pendingFocusRef = useRef(false)

  const page = doc.pages[pageIndex]
  const viewport: Viewport = { zoom, pageHeight: page?.height ?? 0 }

  const pageSlots = useMemo(
    () => store.slots.filter((slot) => slot.page === pageIndex),
    [store.slots, pageIndex],
  )

  const handleCanvasClick = (screen: LogicalPoint) => {
    const atPdf = toPdfPoint(screen, viewport)
    pendingFocusRef.current = true
    store.addSlot(atPdf, pageIndex)
  }

  // Keyboard undo/redo. The toolbar (Task 17) will own visible buttons for
  // this, but store.undo()/redo() need *some* way to be triggered for the
  // store to be usable at all in this task's slice -- the conventional
  // Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z bindings are the minimal, standard way to
  // do that without building toolbar UI. Ignored while a slot's textarea is
  // focused, so the input's own native undo (e.g. undoing an IME
  // composition) isn't fought over.
  const { undo, redo } = store
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isModified = event.metaKey || event.ctrlKey
      if (!isModified || event.key.toLowerCase() !== 'z') return
      if (event.target instanceof HTMLTextAreaElement) return
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo])

  if (!page) return null

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <PageCanvas bytes={doc.source} pageIndex={pageIndex} zoom={zoom} onCanvasClick={handleCanvasClick} />
      {/*
        pointerEvents: 'none' on this wrapper (and 'auto' on each
        SlotOverlay below) is what lets a click on empty canvas fall
        through to PageCanvas's own onClick instead of being swallowed by
        an overlay layer that covers the whole page.
      */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {fontMetrics &&
          pageSlots.map((slot) => (
            <SlotOverlay
              key={slot.id}
              slot={slot}
              viewport={viewport}
              metrics={fontMetrics[slot.fontId]}
              selected={store.selectedId === slot.id}
              autoFocus={pendingFocusRef.current && store.selectedId === slot.id}
              onFocused={() => {
                pendingFocusRef.current = false
              }}
              onSelect={() => store.select(slot.id)}
              onChange={(patch) => store.updateSlot(slot.id, patch)}
              onCommit={store.commitEdit}
            />
          ))}
      </div>
    </div>
  )
}
