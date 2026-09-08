'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { toast } from 'sonner'
import {
  FONT_IDS,
  collectUnsupportedCharacters,
  createFontMetrics,
  describeUnsupportedCharacters,
  findUnsupportedSlots,
  toPdfPoint,
  type EditorDocument,
  type FontId,
  type FontMetrics,
  type Slot,
  type Viewport,
} from '@pdf-slot/core'
import { loadFontBytes, registerFontFaces } from '@/lib/fonts/loadFonts'
import { saveSession } from '@/lib/persistence/indexeddb'
import { PageCanvas } from './canvas/PageCanvas'
import type { LogicalPoint } from './canvas/coordinates'
import { useEditorStore } from './state/useEditorStore'
import { SlotOverlay } from './overlay/SlotOverlay'
import { useCommitRender } from './pipeline/useCommitRender'
import { createSlotCommands } from './pipeline/slotCommands'
import { Toolbar, clampZoom } from './toolbar/Toolbar'

/** Debounce window for persisting to IndexedDB: a drag or a fast typist
 * produces many state updates a second, and writing on every one of them
 * would thrash storage for no benefit -- see task-18-brief.md. */
const SAVE_DEBOUNCE_MS = 1000

/** Stable id so the unsupported-character toast is replaced, not stacked. */
const UNSUPPORTED_TOAST_ID = 'unsupported-characters'

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
      if (cancelled) return
      console.error('Failed to load editor fonts', err)
      // Not just a console line: `metrics` stays null, and Editor renders
      // no SlotOverlay at all without it -- so clicking the page creates
      // slots that are invisible and untypeable. Silently, the editor
      // simply stops working. The user has to be told.
      toast.error('Could not load the editor fonts. Reload the page to try again.')
    })
    return () => {
      cancelled = true
    }
  }, [])

  return metrics
}

export function Editor({
  doc,
  initialSlots,
  onStartOver,
}: {
  doc: EditorDocument
  /** Seeds a restored session's slots (Task 18). Omitted for a fresh upload. */
  initialSlots?: Slot[]
  /** Clears the persisted session and returns to the dropzone. Optional so
   * existing callers/tests that don't restore a session need not pass it --
   * Toolbar simply omits the control in that case. */
  onStartOver?(): void
}) {
  // Zoom and the current page are the toolbar's (Task 17) to control now --
  // Editor owns the state because it also needs it to compute the
  // viewport/transform for rendering and click handling, but nothing above
  // Editor cares about either value.
  const [zoom, setZoom] = useState(1)
  const [pageIndex, setPageIndex] = useState(0)
  const store = useEditorStore(initialSlots)
  const fontMetrics = useFontMetrics()
  const { bytes, isRendering, renderedSlots, error, commit, flush } = useCommitRender(doc, store.slots)

  // Spec §8's export gate. Per slot, with that slot's own face, because the
  // answer depends on `fontId` and not on the text alone. Derived during
  // render (rather than only checked at commit) because the Download button
  // has to stay disabled for as long as the offending text is present, not
  // just for the instant after a commit.
  const unsupportedSlots = useMemo(
    () => (fontMetrics ? findUnsupportedSlots(store.slots, (id) => fontMetrics[id]) : []),
    [fontMetrics, store.slots],
  )
  const unsupportedCharacters = useMemo(
    () => collectUnsupportedCharacters(unsupportedSlots),
    [unsupportedSlots],
  )
  const downloadBlockedReason =
    unsupportedCharacters.length > 0
      ? `The selected font can't draw ${describeUnsupportedCharacters(unsupportedCharacters)}. Remove or replace ${unsupportedCharacters.length === 1 ? 'it' : 'them'} to download.`
      : null

  // Named characters, surfaced the moment they appear rather than only at
  // the next commit boundary. pdf-lib will not raise on this input -- it
  // draws .notdef boxes and saves happily -- so nothing downstream would
  // ever tell the user, and by the time they press the (now disabled)
  // Download button they would have no idea why. Driven off the derived
  // reason rather than read inside handleCommit, because a commit-time read
  // has to come from a ref to stay current across Toolbar's flushSync path
  // (a font change is exactly what turns supported text unsupported), and
  // eslint-plugin-react-hooks's `refs` rule forbids handing such a closure
  // to createSlotCommands. A stable toast id means a changed set replaces
  // the message instead of stacking another copy, and dismissing on the
  // way back to null clears it as soon as the text is fixed.
  useEffect(() => {
    if (downloadBlockedReason) toast.error(downloadBlockedReason, { id: UNSUPPORTED_TOAST_ID })
    else toast.dismiss(UNSUPPORTED_TOAST_ID)
  }, [downloadBlockedReason])

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

  // Toolbar's controls (Task 17) change a slot and commit in the very same
  // click handler, with no render in between -- unlike SlotOverlay's
  // onChange/onCommit, which are always separated by further
  // keystroke/pointermove renders that naturally refresh
  // useCommitRender's own ref before onCommit fires. Pulled out into
  // slotCommands.ts (see its doc comment for the full explanation of why
  // this needs flushSync) so the exact same logic is directly testable
  // against a real store + real useCommitRender, without mounting the rest
  // of Editor.
  const { updateSlotAndCommit, removeSlotAndCommit } = createSlotCommands(store, handleCommit)

  // Debounced persistence to IndexedDB (Task 18): the document bytes and
  // the current slots are saved ~1s after they last changed, so a reload
  // restores the session instead of dropping it. Keyed on `store.slots`
  // itself (a fresh array/object on every add/update/remove, per
  // editorHistory.ts) rather than on commit boundaries, so a fast typist or
  // an in-progress drag reschedules the same debounced write instead of
  // firing one per keystroke/pointermove. Undo/redo history is deliberately
  // NOT part of what's saved -- it's a bounded, in-memory-only stack, and
  // restoring it would multiply the stored size for little benefit.
  // saveSession itself never throws (see indexeddb.ts): a private-browsing
  // tab or an exhausted quota degrades to "this session just isn't saved",
  // not a broken editor.
  //
  // The pending write is also held in a ref so it can be *flushed* rather
  // than dropped when the editor goes away: this effect's cleanup runs on
  // every slot change (that is how the debounce works), so it must not
  // write there, but an unmount or a tab close would otherwise silently
  // discard up to a second of edits -- in the feature whose whole purpose
  // is not losing them. The flush lives in its own mount-scoped effect
  // below.
  const pendingSaveRef = useRef<{ doc: EditorDocument; slots: Slot[] } | null>(null)
  useEffect(() => {
    pendingSaveRef.current = { doc, slots: store.slots }
    const timer = setTimeout(() => {
      pendingSaveRef.current = null
      void saveSession(doc, store.slots)
    }, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [doc, store.slots])

  useEffect(() => {
    const flushSave = () => {
      const pending = pendingSaveRef.current
      if (!pending) return
      pendingSaveRef.current = null
      void saveSession(pending.doc, pending.slots)
    }
    // `beforeunload` covers a deliberate close/reload. `visibilitychange`
    // to hidden covers the cases it does not: a discarded background tab,
    // and mobile, where `beforeunload` is unreliable or never fires. Both
    // only ever write an *already pending* debounced save, so the extra
    // listener costs nothing on an idle tab.
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushSave()
    }
    window.addEventListener('beforeunload', flushSave)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('beforeunload', flushSave)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      flushSave()
    }
  }, [])

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
  const isPainted = bytes !== null && paintedBytes === bytes

  // A new document invalidates both of these: `paintedBytes` belonged to
  // the old doc's canvas, and a newly loaded document may have fewer pages
  // than the one being replaced (pageIndex must not point past its end).
  // Adjusted synchronously during render -- comparing to the doc id this
  // render last reset for and resetting in the same pass -- rather than in
  // an effect (React's documented pattern for resetting state when a prop
  // changes: https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  // This avoids both the eslint-plugin-react-hooks `set-state-in-effect`
  // warning and an extra render cycle where stale paintedBytes/pageIndex
  // would briefly still be visible after the doc swap.
  const [resetForDocId, setResetForDocId] = useState(doc.id)
  if (doc.id !== resetForDocId) {
    setResetForDocId(doc.id)
    setPaintedBytes(null)
    setPageIndex(0)
  }

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
  // id matches store.selectedId while this flag is set is the one to
  // focus. Real state, not a ref: the eslint-plugin-react-hooks `refs`
  // rule forbids reading a ref's `.current` during render (JSX below
  // reads this), and `handleCanvasClick` sets it and `store.addSlot`
  // selects the new slot in the very same synchronous handler, so both
  // updates land in the same batched re-render regardless.
  const [awaitingFocusAfterClick, setAwaitingFocusAfterClick] = useState(false)

  const page = doc.pages[pageIndex]
  const viewport: Viewport = { zoom, pageHeight: page?.height ?? 0 }

  const pageSlots = useMemo(
    () => store.slots.filter((slot) => slot.page === pageIndex),
    [store.slots, pageIndex],
  )

  // "Start over" deletes the persisted session, so the pending debounced
  // write must be dropped rather than flushed -- otherwise the unmount
  // flush below writes the session straight back after it was cleared, and
  // "start over" quietly doesn't.
  const handleStartOver = onStartOver
    ? () => {
        pendingSaveRef.current = null
        onStartOver()
      }
    : undefined

  const handleCanvasClick = (screen: LogicalPoint) => {
    const atPdf = toPdfPoint(screen, viewport)
    setAwaitingFocusAfterClick(true)
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
        flush={flush}
        downloadBlockedReason={downloadBlockedReason}
        slots={store.slots}
        selectedId={store.selectedId}
        updateSlotAndCommit={updateSlotAndCommit}
        removeSlotAndCommit={removeSlotAndCommit}
        zoom={zoom}
        onZoomChange={(next) => setZoom(clampZoom(next))}
        onFitWidth={handleFitWidth}
        pageIndex={pageIndex}
        pageCount={doc.pages.length}
        onPageChange={setPageIndex}
        onStartOver={handleStartOver}
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
                autoFocus={awaitingFocusAfterClick && store.selectedId === slot.id}
                onFocused={() => {
                  setAwaitingFocusAfterClick(false)
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
