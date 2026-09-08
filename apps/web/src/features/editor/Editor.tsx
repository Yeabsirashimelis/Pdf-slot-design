'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { toast } from 'sonner'
import {
  FONT_IDS,
  createFontMetrics,
  toPdfPoint,
  type EditorDocument,
  type FontId,
  type FontMetrics,
  type Slot,
  type Viewport,
} from '@pdf-slot/core'
import { loadFontBytes, registerFontFaces } from '@/lib/fonts/loadFonts'
import { PageCanvas } from './canvas/PageCanvas'
import type { LogicalPoint } from './canvas/coordinates'
import { useEditorStore } from './state/useEditorStore'
import { SlotOverlay } from './overlay/SlotOverlay'
import { useCommitRender } from './pipeline/useCommitRender'
import { Toolbar, clampZoom } from './toolbar/Toolbar'

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

export function Editor({ doc }: { doc: EditorDocument }) {
  // Zoom and the current page are the toolbar's (Task 17) to control now --
  // Editor owns the state because it also needs it to compute the
  // viewport/transform for rendering and click handling, but nothing above
  // Editor cares about either value.
  const [zoom, setZoom] = useState(1)
  const [pageIndex, setPageIndex] = useState(0)
  const store = useEditorStore()
  const fontMetrics = useFontMetrics()
  const { bytes, isRendering, renderedSlots, error, commit } = useCommitRender(doc, store.slots)

  // The single wiring point for "an edit committed": store.commitEdit()
  // closes the undo boundary (Task 13/14's concern) and commit() re-renders
  // the real PDF from the now-final slots (this task's). Both fire from the
  // same trigger -- a slot's textarea blurring, or a drag/resize gesture
  // ending -- so they're combined here rather than making every caller
  // remember to invoke both.
  const handleCommit = () => {
    store.commitEdit()
    commit()
  }

  // A failed render is surfaced rather than silently dropped -- otherwise
  // the edit that failed to render would just vanish (see isSlotCommitted:
  // bytes/renderedSlots don't advance on failure, so the DOM text for the
  // slot that failed stays visible on its own; this toast is what tells the
  // user *why* the canvas didn't just update).
  useEffect(() => {
    if (error) toast.error(error.message || 'Failed to render the PDF.')
  }, [error])

  // Tracks which exact `bytes` value pdf.js has actually finished painting
  // -- rendering (renderPdf resolving) and painting (pdf.js loading +
  // drawing that page) are two separate async stages, so `bytes` having
  // changed is not by itself proof the canvas shows it yet.
  const [paintedBytes, setPaintedBytes] = useState<Uint8Array | null>(null)
  useEffect(() => {
    setPaintedBytes(null)
  }, [doc.id])
  const isPainted = bytes !== null && paintedBytes === bytes

  // A newly loaded document may have fewer pages than the one being
  // replaced -- reset to its first page rather than pointing past the end.
  useEffect(() => {
    setPageIndex(0)
  }, [doc.id])

  // Per-slot, not a single page-wide flag: `renderPdf` always re-renders
  // every slot on the page, so gating on "is *a* render in flight" would
  // hide-then-reshow every OTHER already-committed slot's DOM text (over
  // its own still-correct, unchanged canvas glyphs -- a double-struck
  // flash) merely because a *different* slot is mid-edit. `applyUpdateSlot`
  // only replaces the one edited slot's object; every other slot keeps its
  // reference, so comparing by identity against the slot array that
  // `bytes` was actually rendered from tells each slot, independently,
  // whether *its own* current content is what's painted.
  const isSlotCommitted = (slot: Slot): boolean => {
    if (!isPainted || !renderedSlots) return false
    return renderedSlots.find((s) => s.id === slot.id) === slot
  }

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

  // Measured on demand (a click), not tracked continuously -- avoids
  // depending on ResizeObserver (unavailable in this project's jsdom test
  // environment) for a value that only matters at the instant the button
  // is pressed. `rootRef`'s div is a block-level flex container with no
  // width of its own, so its clientWidth is the real available layout
  // width, independent of the canvas's own (possibly zoomed-out) size.
  const rootRef = useRef<HTMLDivElement>(null)
  const handleFitWidth = () => {
    const availableWidth = rootRef.current?.clientWidth ?? 0
    if (availableWidth <= 0 || !page || page.width <= 0) return
    setZoom(clampZoom(availableWidth / page.width))
  }

  // Keyboard undo/redo. Task 17's toolbar brief doesn't call for visible
  // undo/redo buttons (only font/size/colour/align/delete plus zoom and
  // page navigation), so these Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z bindings
  // remain the only way to trigger store.undo()/redo(). Ignored while a
  // slot's textarea is focused, so the input's own native undo (e.g.
  // undoing an IME composition) isn't fought over.
  const { undo, redo } = store
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isModified = event.metaKey || event.ctrlKey
      if (!isModified || event.key.toLowerCase() !== 'z') return
      if (event.target instanceof HTMLTextAreaElement) return
      event.preventDefault()
      // commit() reads the current slots through a ref that useCommitRender
      // updates during its own render (see pipeline/useCommitRender.ts) --
      // it does NOT read React state directly. undo()/redo() schedule a
      // state update that, left alone, applies asynchronously, so calling
      // commit() right after them would still see the PRE-undo slots and
      // render/paint the wrong content while the store itself had already
      // moved on. flushSync forces that update (and this component's
      // re-render, which refreshes the ref) to happen synchronously first.
      flushSync(() => {
        if (event.shiftKey) redo()
        else undo()
      })
      commit()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo, commit])

  if (!page) return null

  return (
    <div
      ref={rootRef}
      style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', alignItems: 'flex-start' }}
    >
      <Toolbar
        doc={doc}
        bytes={bytes}
        isRendering={isRendering}
        slots={store.slots}
        selectedId={store.selectedId}
        updateSlot={store.updateSlot}
        removeSlot={store.removeSlot}
        onCommit={handleCommit}
        zoom={zoom}
        onZoomChange={(next) => setZoom(clampZoom(next))}
        onFitWidth={handleFitWidth}
        pageIndex={pageIndex}
        pageCount={doc.pages.length}
        onPageChange={setPageIndex}
      />
      <div style={{ position: 'relative', display: 'inline-block' }}>
        {/*
          Once a commit has produced real output bytes, those bytes -- not
          doc.source -- are what pdf.js paints: from this point on the
          preview literally is a picture of the file a download would save,
          not a separate approximation of it. Before the first commit, the
          canvas still shows the unedited source PDF.
        */}
        <PageCanvas
          bytes={bytes ?? doc.source}
          pageIndex={pageIndex}
          zoom={zoom}
          onCanvasClick={handleCanvasClick}
          onRendered={setPaintedBytes}
        />
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
                onCommit={handleCommit}
                textCommitted={isSlotCommitted(slot)}
              />
            ))}
        </div>
      </div>
    </div>
  )
}
