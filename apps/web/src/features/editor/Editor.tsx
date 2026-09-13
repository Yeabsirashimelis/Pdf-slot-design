'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  type Point,
  type Slot,
  type Viewport,
} from '@pdf-slot/core'
import { loadFontBytes, registerFontFaces } from '@/lib/fonts/loadFonts'
import { PageCanvas } from './canvas/PageCanvas'
import type { LogicalPoint } from './canvas/coordinates'
import { useEditorStore, type EditorStore } from './state/useEditorStore'
import { SlotOverlay } from './overlay/SlotOverlay'
import { useCommitRender } from './pipeline/useCommitRender'
import { createSlotCommands } from './pipeline/slotCommands'
import { Toolbar, clampZoom } from './toolbar/Toolbar'

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

/**
 * Verification mode (see useCommitRender): re-render and repaint the real
 * PDF on every commit so the overlay can be checked against the actual
 * output while editing. Off by default -- the overlay is the preview and
 * the PDF is generated once, on download.
 */
const RENDER_ON_COMMIT = process.env.NEXT_PUBLIC_RENDER_ON_COMMIT === 'true'

export function Editor({
  doc,
  initialSlots,
  store: externalStore,
  locked = false,
  highlighted = false,
  onPlaceSlot,
  onStartOver,
  renderOnCommit = RENDER_ON_COMMIT,
}: {
  doc: EditorDocument
  /** Seeds the slots of the store Editor creates for itself. Ignored when
   * `store` is given (the owner of that store seeded it). */
  initialSlots?: Slot[]
  /** When given, Editor edits this store instead of creating its own. The
   * two-step template flow (`features/template`) owns the store -- and the
   * persistence of what's in it -- across both steps, so Editor must not
   * hold the slots itself. */
  store?: EditorStore
  /** Step 2 of the template flow: slots can be typed into but not moved,
   * resized, restyled or added. Forwarded to every SlotOverlay and to the
   * Toolbar; clicks on empty canvas are ignored. */
  locked?: boolean
  /** Tints every slot so a fill-in user can see where the slots are. */
  highlighted?: boolean
  /** When given, a click on empty canvas asks the parent to place a slot
   * (at `atPdf`, in PDF points, on `page`) instead of calling
   * `store.addSlot` directly -- so the parent can, say, open a naming
   * dialog first. */
  onPlaceSlot?(atPdf: Point, page: number): void
  /** Returns to the dropzone. Optional so callers/tests that have no
   * "start over" need not pass it -- Toolbar simply omits the control. */
  onStartOver?(): void
  /** Overrides NEXT_PUBLIC_RENDER_ON_COMMIT; tests use it to exercise verification mode. */
  renderOnCommit?: boolean
}) {
  // Zoom and the current page are the toolbar's (Task 17) to control now --
  // Editor owns the state because it also needs it to compute the
  // viewport/transform for rendering and click handling, but nothing above
  // Editor cares about either value.
  const [zoom, setZoom] = useState(1)
  const [pageIndex, setPageIndex] = useState(0)
  // Hooks run unconditionally: the own store is always created, and simply
  // goes unused when the parent supplies one.
  const ownStore = useEditorStore(initialSlots)
  const store = externalStore ?? ownStore
  const fontMetrics = useFontMetrics()
  const { bytes, isRendering, renderedSlots, error, commit, render } = useCommitRender(doc, store.slots, {
    renderOnCommit,
  })

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

  // A failed render is surfaced rather than silently dropped -- otherwise
  // the edit that failed to render would just vanish (see isSlotCommitted:
  // bytes/renderedSlots don't advance on failure, so the DOM text for the
  // slot that failed stays visible on its own; this toast is what tells the
  // user *why* the canvas didn't just update).
  useEffect(() => {
    if (error) toast.error(error.message || 'Failed to render the PDF.')
  }, [error])

  // Tracks the slot array the canvas *currently shows* -- rendering
  // (renderPdf resolving) and painting (pdf.js loading + drawing that
  // page) are two separate async stages, so `bytes`/`renderedSlots` having
  // advanced is not by itself proof the canvas shows them yet. Recorded
  // when PageCanvas reports the paint done: at that moment the painted
  // bytes are still the current ones (PageCanvas cancels a paint the
  // instant its bytes are superseded, and never reports a cancelled one),
  // so `renderedSlots` is exactly the array those bytes came from. Read
  // through a ref so `handlePainted` stays referentially stable -- it is
  // in PageCanvas's effect deps, and a fresh identity per render would
  // re-run that effect (and repaint the page) on every keystroke.
  const [paintedSlots, setPaintedSlots] = useState<Slot[] | null>(null)
  const renderedSlotsRef = useRef(renderedSlots)
  useEffect(() => {
    renderedSlotsRef.current = renderedSlots
  })
  const handlePainted = useCallback(() => {
    setPaintedSlots(renderedSlotsRef.current)
  }, [])

  // A new document invalidates both of these: `paintedSlots` belonged to
  // the old doc's canvas, and a newly loaded document may have fewer pages
  // than the one being replaced (pageIndex must not point past its end).
  // Adjusted synchronously during render -- comparing to the doc id this
  // render last reset for and resetting in the same pass -- rather than in
  // an effect (React's documented pattern for resetting state when a prop
  // changes: https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  // This avoids both the eslint-plugin-react-hooks `set-state-in-effect`
  // warning and an extra render cycle where stale paintedSlots/pageIndex
  // would briefly still be visible after the doc swap.
  const [resetForDocId, setResetForDocId] = useState(doc.id)
  if (doc.id !== resetForDocId) {
    setResetForDocId(doc.id)
    setPaintedSlots(null)
    setPageIndex(0)
  }

  // Per-slot, not a single page-wide flag: `renderPdf` always re-renders
  // every slot on the page, so gating on "is *a* render in flight" would
  // hide-then-reshow every OTHER already-committed slot's DOM text (over
  // its own still-correct, unchanged canvas glyphs -- a double-struck
  // flash) merely because a *different* slot is mid-edit. `applyUpdateSlot`
  // only replaces the one edited slot's object; every other slot keeps its
  // reference, so comparing by identity against the slot array the canvas
  // is actually *showing* tells each slot, independently, whether its own
  // current content is what's painted. Against `paintedSlots`, not
  // `renderedSlots`: between a commit's bytes landing and pdf.js finishing
  // the paint, the canvas still shows the previous render -- and a slot
  // unchanged since then is drawn correctly on it already. Gating on the
  // newer array (or on "are the latest bytes painted yet") re-showed every
  // committed slot's DOM text for that window, on every commit.
  const isSlotCommitted = (slot: Slot): boolean => {
    if (!paintedSlots) return false
    return paintedSlots.find((s) => s.id === slot.id) === slot
  }

  // Set right before a canvas click creates a new slot, so the SlotOverlay
  // that mounts for it knows to grab focus once. This is what connects "a
  // slot was just created" to "focus it": the store auto-selects a newly
  // added slot, so the next slot whose id matches store.selectedId while
  // this flag is set is the one to focus. Real state, not a ref: the
  // eslint-plugin-react-hooks `refs` rule forbids reading a ref's `.current`
  // during render (JSX below reads this), and `handleCanvasClick` sets it
  // and `store.addSlot` selects the new slot in the very same synchronous
  // handler, so both updates land in the same batched re-render regardless.
  const [awaitingFocusAfterClick, setAwaitingFocusAfterClick] = useState(false)

  const page = doc.pages[pageIndex]
  const viewport: Viewport = { zoom, pageHeight: page?.height ?? 0 }

  const pageSlots = useMemo(
    () => store.slots.filter((slot) => slot.page === pageIndex),
    [store.slots, pageIndex],
  )

  const handleCanvasClick = (screen: LogicalPoint) => {
    if (locked) return
    const atPdf = toPdfPoint(screen, viewport)
    if (onPlaceSlot) {
      onPlaceSlot(atPdf, pageIndex)
      return
    }
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

  // A document opens at fit-width, not at 100%. 100% maps PDF points 1:1
  // to CSS pixels, which shows a print-sized form with its 6-7pt text at
  // 8-9px -- rendered correctly, but too small to read until the user
  // zooms in. Every PDF viewer opens as large as the column allows; so
  // does this one, once per document. Done from a callback ref rather
  // than an effect because the width can only be measured once the root
  // is in the DOM, and the ref callback is exactly that moment (and
  // re-runs when `doc` changes, since it is recreated then).
  const fittedForDocIdRef = useRef<string | null>(null)
  const setRootRef = useCallback(
    (el: HTMLDivElement | null) => {
      rootRef.current = el
      if (!el || fittedForDocIdRef.current === doc.id) return
      fittedForDocIdRef.current = doc.id
      const firstPageWidth = doc.pages[0]?.width ?? 0
      if (el.clientWidth > 0 && firstPageWidth > 0) setZoom(clampZoom(el.clientWidth / firstPageWidth))
    },
    [doc],
  )

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
      ref={setRootRef}
      // `flex: 1` + `minWidth: 0` so that, as a flex-row item beside the
      // template side panel, this root spans the remaining column width --
      // which is what fit-width (above) measures. A block parent ignores
      // both, so a standalone Editor is unaffected.
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        alignItems: 'flex-start',
        flex: 1,
        minWidth: 0,
      }}
    >
      <Toolbar
        isRendering={isRendering}
        render={render}
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
        onStartOver={onStartOver}
        locked={locked}
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
          onRendered={handlePainted}
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
                locked={locked}
                highlighted={highlighted}
              />
            ))}
        </div>
      </div>
    </div>
  )
}
