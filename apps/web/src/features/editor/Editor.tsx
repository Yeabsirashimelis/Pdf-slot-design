'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import type { StagePoint } from './canvas/coordinates'
import { useEditorStore, type EditorStore } from './state/useEditorStore'
import { SlotOverlay } from './overlay/SlotOverlay'
import { useCommitRender } from './pipeline/useCommitRender'
import { createSlotCommands } from './pipeline/slotCommands'
import { Toolbar } from './toolbar/Toolbar'
import { useEditorShortcuts } from './useEditorShortcuts'
import { useSlotClipboard, type PasteTarget } from './useSlotClipboard'
import { useZoom } from './useZoom'

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
  readOnly = false,
  onPlaceSlot,
  onDuplicateSlot,
  onPasteSlot,
  pageIndex: controlledPageIndex,
  onPageChange,
  slotLabels,
  fileName,
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
  /** Step 1 of the template flow: boxes can be placed, moved, resized and
   * styled but not typed into (see SlotOverlay's `readOnly`). */
  readOnly?: boolean
  /** When given, a click on empty canvas asks the parent to place a slot
   * (at `atPdf`, in PDF points, on `page`) instead of calling
   * `store.addSlot` directly -- so the parent can, say, open a naming
   * dialog first. */
  onPlaceSlot?(atPdf: Point, page: number): void
  /** When given, duplicating (toolbar button or Ctrl/Cmd+D) asks the
   * parent instead of calling `store.duplicateSlot` directly -- so the
   * parent can name the copy. Receives the source slot's id. */
  onDuplicateSlot?(id: string): void
  /** When given, pasting (Ctrl/Cmd+V) asks the parent instead of calling
   * `store.pasteSlot` directly -- so the parent can name the copy after
   * `label`, the copied slot's name at the time it was copied. */
  onPasteSlot?(snapshot: Slot, label: string | undefined, target: PasteTarget): string
  /** Controlled page (with `onPageChange`); Editor keeps its own otherwise. */
  pageIndex?: number
  onPageChange?(page: number): void
  /** Names to show as a small label above each slot's box, by slot id. */
  slotLabels?: Record<string, string>
  /** The uploaded file's name, kept for the download. */
  fileName?: string
  /** Returns to the dropzone. Optional so callers/tests that have no
   * "start over" need not pass it -- Toolbar simply omits the control. */
  onStartOver?(): void
  /** Overrides NEXT_PUBLIC_RENDER_ON_COMMIT; tests use it to exercise verification mode. */
  renderOnCommit?: boolean
}) {
  // Zoom (fit-width = 100%) lives in useZoom; the current page is local
  // state because the toolbar, the canvas and click handling all need it.
  const { zoom, scale, setScale, fitWidth, rootRef } = useZoom(doc)
  // The current page: Editor's own unless the parent controls it (the
  // template flow does, so its side panel can jump to a slot's page).
  const [ownPageIndex, setOwnPageIndex] = useState(0)
  const pageIndex = controlledPageIndex ?? ownPageIndex
  const setPageIndex = onPageChange ?? setOwnPageIndex
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
  const { updateSlotAndCommit, removeSlotAndCommit, duplicateSlotAndCommit, pasteSlotAndCommit } = createSlotCommands(
    store,
    handleCommit,
  )
  // The parent (TemplateEditor) owns slot names, so it gets first refusal
  // on a duplicate; a standalone Editor copies straight into its store.
  const duplicateSlot = (id: string): string | null => {
    if (onDuplicateSlot) {
      onDuplicateSlot(id)
      return null
    }
    return duplicateSlotAndCommit(id)
  }

  // The last pointer position over the page stage (logical px from its
  // top-left), so a paste can land under the pointer; null once it leaves.
  const pointerRef = useRef<StagePoint | null>(null)
  const clipboard = useSlotClipboard()
  // Paste and Alt+drag both add a copy of a snapshot at a position; the
  // parent (which owns names) gets first refusal, as for duplicate.
  const addCopy = (snapshot: Slot, label: string | undefined, target: PasteTarget): string =>
    onPasteSlot ? onPasteSlot(snapshot, label, target) : pasteSlotAndCommit(snapshot, target)
  const pasteCopied = () => {
    if (locked) return
    const held = clipboard.take(pointerRef.current, viewport, pageIndex)
    if (held) addCopy(held.slot, held.label, held.target)
  }
  // Alt+drag: the copy starts exactly over its source, then follows the pointer.
  const cloneInPlace = (slot: Slot): string | null =>
    locked ? null : addCopy(slot, slotLabels?.[slot.id], { page: slot.page, x: slot.x, y: slot.y })

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
    setOwnPageIndex(0)
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

  const handleCanvasClick = (stage: StagePoint) => {
    if (locked) return
    // Stage px are points already (PageCanvas divided the screen distance
    // by the zoom it was given), so the flip to PDF space is at zoom 1.
    const atPdf = toPdfPoint(stage, { zoom: 1, pageHeight: viewport.pageHeight })
    if (onPlaceSlot) {
      onPlaceSlot(atPdf, pageIndex)
      return
    }
    setAwaitingFocusAfterClick(true)
    store.addSlot(atPdf, pageIndex)
  }

  useEditorShortcuts({
    undo: store.undo,
    redo: store.redo,
    commit,
    duplicateSelected: () => {
      if (locked || !store.selectedId) return
      duplicateSlot(store.selectedId)
    },
    nudgeSelected: (dx, dy) => {
      if (locked || !store.selectedId) return
      store.nudgeSlot(store.selectedId, dx, dy)
      commit()
    },
    copySelected: () => {
      const selected = store.slots.find((slot) => slot.id === store.selectedId)
      if (locked || !selected) return
      clipboard.copy(selected, slotLabels?.[selected.id])
    },
    pasteCopied,
  })

  if (!page) return null

  return (
    <div
      ref={rootRef}
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
        fileName={fileName}
        slots={store.slots}
        selectedId={store.selectedId}
        updateSlotAndCommit={updateSlotAndCommit}
        removeSlotAndCommit={removeSlotAndCommit}
        duplicateSlotAndCommit={duplicateSlot}
        zoom={scale}
        onZoomChange={setScale}
        onFitWidth={fitWidth}
        pageIndex={pageIndex}
        pageCount={doc.pages.length}
        onPageChange={setPageIndex}
        onStartOver={onStartOver}
        locked={locked}
      />
      {/* The stage is the page at this zoom; PageCanvas fills it. */}
      <div
        // Nothing on the stage is text to select or a thing to drag natively:
        // a drag across empty canvas would otherwise silently select the
        // overlay's labels and lines, and the next press inside that
        // selection would start the browser's own drag-and-drop of it (a
        // "no drop" cursor, a ghost of the page) instead of our slot drag.
        // The textarea opts back in (SlotOverlay) so typing still selects.
        style={{ position: 'relative', width: page.width * zoom, height: page.height * zoom, userSelect: 'none' }}
        data-testid="page-stage"
        data-zoom={zoom}
        onDragStart={(event) => event.preventDefault()}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          pointerRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top }
        }}
        onPointerLeave={() => {
          pointerRef.current = null
        }}
      >
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
          screenScale={zoom}
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
                onChange={(patch, targetId = slot.id) => store.updateSlot(targetId, patch)}
                onCloneStart={() => cloneInPlace(slot)}
                onCommit={handleCommit}
                textCommitted={isSlotCommitted(slot)}
                locked={locked}
                highlighted={highlighted}
                readOnly={readOnly}
                label={slotLabels?.[slot.id]}
              />
            ))}
        </div>
      </div>
    </div>
  )
}
