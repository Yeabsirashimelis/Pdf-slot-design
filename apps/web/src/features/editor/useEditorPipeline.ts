'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  FONT_IDS,
  collectUnsupportedCharacters,
  createFontMetrics,
  describeUnsupportedCharacters,
  findUnsupportedSlots,
  type EditorDocument,
  type FontId,
  type FontMetrics,
  type Slot,
} from '@pdf-slot/core'
import { loadFontBytes, registerFontFaces } from '@/lib/fonts/loadFonts'
import type { EditorStore } from './state/useEditorStore'
import { useCommitRender } from './pipeline/useCommitRender'
import { createSlotCommands, type SlotCommands } from './pipeline/slotCommands'

/** Stable id so the unsupported-character toast is replaced, not stacked. */
const UNSUPPORTED_TOAST_ID = 'unsupported-characters'

/**
 * Verification mode (see useCommitRender): re-render and repaint the real
 * PDF on every commit so the overlay can be checked against the actual
 * output while editing. Off by default -- the overlay is the preview and
 * the PDF is generated once, on download.
 */
const RENDER_ON_COMMIT = process.env.NEXT_PUBLIC_RENDER_ON_COMMIT === 'true'

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
      // Not just a console line: `metrics` stays null, and the workspace
      // renders no SlotOverlay at all without it -- so clicking the page
      // creates slots that are invisible and untypeable. Silently, the
      // editor simply stops working. The user has to be told.
      toast.error('Could not load the editor fonts. Reload the page to try again.')
    })
    return () => {
      cancelled = true
    }
  }, [])

  return metrics
}

export type EditorPipeline = SlotCommands & {
  /** Null until the bundled fonts have loaded; nothing can be laid out before then. */
  fontMetrics: Record<FontId, FontMetrics> | null
  /** The last committed output, or null before the first commit (the canvas then shows the source). */
  bytes: Uint8Array | null
  isRendering: boolean
  /** The one render a download performs; null when it failed (see DownloadButton). */
  render(): Promise<Uint8Array | null>
  /** A commit boundary without a store change (keyboard undo/redo/nudge call it after their own update). */
  commit(): void
  /** "An edit committed": closes the undo boundary and commits, in one place. */
  handleCommit(): void
  /** Non-null while a slot holds characters no bundled face can draw; Download is blocked with this reason. */
  downloadBlockedReason: string | null
  /** For PageCanvas's onRendered: records which slots the canvas now shows. */
  handlePainted(): void
  /** Whether the canvas is showing this exact slot (so its DOM text can hide). */
  isSlotCommitted(slot: Slot): boolean
}

/**
 * Everything between the store and the screen that is not the canvas
 * itself: the fonts and their metrics, the commit → render pipeline, the
 * export gate for unsupported characters, and the mutate-and-commit
 * commands the inspector's controls call. Lifted out of the workspace so
 * the panels beside it share the very same instance.
 */
export function useEditorPipeline(
  doc: EditorDocument,
  store: EditorStore,
  { renderOnCommit = RENDER_ON_COMMIT }: { renderOnCommit?: boolean } = {},
): EditorPipeline {
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
  const unsupportedCharacters = useMemo(() => collectUnsupportedCharacters(unsupportedSlots), [unsupportedSlots])
  const downloadBlockedReason =
    unsupportedCharacters.length > 0
      ? `The selected font can't draw ${describeUnsupportedCharacters(unsupportedCharacters)}. Remove or replace ${unsupportedCharacters.length === 1 ? 'it' : 'them'} to download.`
      : null

  // Named characters, surfaced the moment they appear rather than only at
  // the next commit boundary. pdf-lib will not raise on this input -- it
  // draws .notdef boxes and saves happily -- so nothing downstream would
  // ever tell the user, and by the time they press the (now disabled)
  // Download button they would have no idea why. A stable toast id means
  // a changed set replaces the message instead of stacking another copy,
  // and dismissing on the way back to null clears it as soon as the text
  // is fixed.
  useEffect(() => {
    if (downloadBlockedReason) toast.error(downloadBlockedReason, { id: UNSUPPORTED_TOAST_ID })
    else toast.dismiss(UNSUPPORTED_TOAST_ID)
  }, [downloadBlockedReason])

  // A failed render is surfaced rather than silently dropped -- otherwise
  // the edit that failed to render would just vanish (see isSlotCommitted:
  // bytes/renderedSlots don't advance on failure, so the DOM text for the
  // slot that failed stays visible on its own; this toast is what tells the
  // user *why* the canvas didn't just update).
  useEffect(() => {
    if (error) toast.error(error.message || 'Failed to render the PDF.')
  }, [error])

  // The single wiring point for "an edit committed": store.commitEdit()
  // closes the undo boundary and commit() re-renders the real PDF from the
  // now-final slots. Both fire from the same trigger -- a slot's textarea
  // blurring, or a drag/resize gesture ending -- so they're combined here
  // rather than making every caller remember to invoke both.
  const handleCommit = () => {
    store.commitEdit()
    commit()
  }

  // The inspector's controls change a slot and commit in the very same
  // click handler, with no render in between -- see slotCommands.ts for
  // why that needs flushSync.
  const commands = createSlotCommands(store, handleCommit)

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

  // A new document invalidates `paintedSlots`: it belonged to the old
  // doc's canvas. Adjusted synchronously during render (React's documented
  // pattern for resetting state when a prop changes) rather than in an
  // effect, which would leave a render where the stale value shows.
  const [resetForDocId, setResetForDocId] = useState(doc.id)
  if (doc.id !== resetForDocId) {
    setResetForDocId(doc.id)
    setPaintedSlots(null)
  }

  // Per-slot, not a single page-wide flag: `renderPdf` always re-renders
  // every slot on the page, so gating on "is *a* render in flight" would
  // hide-then-reshow every OTHER already-committed slot's DOM text (over
  // its own still-correct, unchanged canvas glyphs -- a double-struck
  // flash) merely because a *different* slot is mid-edit. `applyUpdateSlot`
  // only replaces the one edited slot's object; every other slot keeps its
  // reference, so comparing by identity against the slot array the canvas
  // is actually *showing* tells each slot, independently, whether its own
  // current content is what's painted.
  const isSlotCommitted = (slot: Slot): boolean => {
    if (!paintedSlots) return false
    return paintedSlots.find((s) => s.id === slot.id) === slot
  }

  return {
    fontMetrics,
    bytes,
    isRendering,
    render,
    commit,
    handleCommit,
    ...commands,
    downloadBlockedReason,
    handlePainted,
    isSlotCommitted,
  }
}
