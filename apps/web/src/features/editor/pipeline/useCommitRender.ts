'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { renderPdf, renderPdfIncremental, type EditorDocument, type Slot } from '@pdf-slot/core'
import { loadFontBytes } from '@/lib/fonts/loadFonts'

/**
 * Owns the real output PDF: renders it on demand (`render`, the download
 * path) and -- when `renderOnCommit` is on -- on every commit boundary
 * (blur / drag-or-resize end), never on a timer.
 *
 * Two modes, one render path:
 *
 * - **Default (`renderOnCommit: false`)**: editing costs nothing. The
 *   overlay is the preview; the PDF is generated once, when the user asks
 *   for it. This is the product direction (2026-09-12): smoothness first,
 *   and the same single render is what a future backend will perform.
 * - **Verification (`renderOnCommit: true`)**: every commit re-renders and
 *   the canvas paints the real bytes, so the overlay can be checked
 *   against the actual output while editing -- the mode that proved the
 *   two equal (and caught the rotated-page bug). Enabled in tests and via
 *   NEXT_PUBLIC_RENDER_ON_COMMIT=true.
 *
 * Whichever mode, the first render is from scratch and every later one is
 * an *increment* appended to the last output (`renderPdfIncremental`), so
 * a second download after more edits never re-writes the whole document.
 */
export function useCommitRender(
  doc: EditorDocument | null,
  slots: Slot[],
  { renderOnCommit = false }: { renderOnCommit?: boolean } = {},
): {
  bytes: Uint8Array | null
  isRendering: boolean
  /**
   * The exact slot array `bytes` was rendered from, so callers can tell --
   * per slot, by object identity -- whether a *particular* slot's current
   * content is what's actually painted on screen. `applyUpdateSlot`
   * (editorHistory.ts) only replaces the one edited slot's object on each
   * change; every other slot keeps its existing reference. So for an
   * untouched slot, `renderedSlots.find(s => s.id === slot.id) === slot`
   * stays true across another slot's commit, and only goes false for the
   * slot whose own content actually changed since the last successful
   * render -- see Editor.tsx's `isSlotCommitted`.
   */
  renderedSlots: Slot[] | null
  /**
   * Set when the most recent commit's render failed; cleared at the start
   * of the next commit. Bytes/renderedSlots deliberately keep their last
   * *successful* values on failure (see the catch branch below) so a
   * failed edit doesn't fall back to some earlier, unrelated render --
   * callers should surface this to the user rather than silently losing
   * the edit.
   */
  error: Error | null
  /** A commit boundary. Renders only when `renderOnCommit` is on. */
  commit(): void
  /**
   * The download path: resolves with bytes that reflect the current slots,
   * or `null` if rendering failed (reported through `error`).
   *
   * Waits for any render already in flight first (pressing Download blurs
   * the focused textarea, and in verification mode blur *is* a commit, so
   * one is typically running), then: reuses the last output if the slots
   * are unchanged since it was produced (two downloads in a row must not
   * append an empty increment), otherwise renders -- from scratch the
   * first time, as an increment on top of the last output after that.
   */
  render(): Promise<Uint8Array | null>
} {
  const [bytes, setBytes] = useState<Uint8Array | null>(null)
  const [isRendering, setIsRendering] = useState(false)
  const [renderedSlots, setRenderedSlots] = useState<Slot[] | null>(null)
  const [error, setError] = useState<Error | null>(null)

  // commit() is handed to blur/pointerup handlers as a stable callback (see
  // Editor.tsx), so it can't close over `doc`/`slots` as dependencies without
  // being recreated every render. These refs are kept in sync with the
  // latest props instead, so commit() always reads the latest values
  // without itself changing identity. Synced from a deps-less effect
  // (runs after every render), not by writing `.current` directly in the
  // render body: eslint-plugin-react-hooks's `refs` rule forbids reading
  // OR writing a ref during render, since render can run more than once
  // (e.g. Strict Mode) before anything commits. This is also what makes it
  // safe for `commit()`'s own flushSync callers (Editor.tsx) to rely on --
  // flushSync flushes pending passive effects (this one included), not
  // just the state update and DOM commit, so by the time a flushSync call
  // returns these refs are already caught up with whatever it just
  // updated.
  const docRef = useRef(doc)
  const slotsRef = useRef(slots)
  useEffect(() => {
    docRef.current = doc
    slotsRef.current = slots
  })

  // Monotonically increasing request id. Renders are async, and a fast user
  // can commit twice before the first finishes -- whichever result's id
  // isn't the latest is discarded, so a slow render can never clobber a
  // newer one and silently desync the preview from what a download would
  // produce.
  const latestRequestId = useRef(0)

  // The currently in-flight render, or null. Written only from `commit()`
  // and from that render's own completion -- never during render, which
  // eslint-plugin-react-hooks's `refs` rule forbids. It deliberately holds
  // a promise that RESOLVES on failure (to `null`) rather than rejecting,
  // so a caller awaiting it never has to catch: `commit()`'s own catch
  // branch is still the single place a render failure is reported.
  const inFlight = useRef<Promise<Uint8Array | null> | null>(null)

  // The last successful output, mirrored from state so `render()` can read
  // it synchronously right after awaiting an in-flight render (the state
  // update has landed by then, but a deps-less effect syncing a ref would
  // not have run yet). Tagged with the document id it belongs to, rather
  // than reset in the doc-change block below (that runs during render,
  // where writing a ref is forbidden): output for another document is
  // simply never used as a base.
  const lastOutput = useRef<{ docId: string; bytes: Uint8Array; slots: Slot[] } | null>(null)

  // A newly loaded document invalidates the committed output that
  // belonged to the previous one. Adjusted synchronously during render --
  // comparing to the doc id this render last reset for and resetting in
  // the same pass -- rather than in an effect (React's documented pattern
  // for resetting state when a prop changes:
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  // This both satisfies eslint-plugin-react-hooks's `set-state-in-effect`
  // rule and avoids an extra render cycle where the old doc's bytes would
  // briefly still be visible after the swap -- see
  // useCommitRender.test.ts's "resets bytes when a new document is
  // loaded", which asserts this synchronously, with no `act(async ...)`.
  // There's deliberately no `latestRequestId.current` bump here (that
  // would itself be a ref write during render): `commit`'s own completion
  // check below additionally compares `docRef.current?.id` against the
  // doc it was called for, which already discards a stale in-flight
  // render from a since-replaced document without needing one.
  const docId = doc?.id ?? null
  const [resetForDocId, setResetForDocId] = useState(docId)
  if (docId !== resetForDocId) {
    setResetForDocId(docId)
    setBytes(null)
    setRenderedSlots(null)
    setIsRendering(false)
    setError(null)
  }

  /** Starts a render of the current slots and records it as in flight. */
  const start = useCallback((): Promise<Uint8Array | null> => {
    const currentDoc = docRef.current
    if (!currentDoc) return Promise.resolve(null)

    const requestId = ++latestRequestId.current
    const currentSlots = slotsRef.current
    setIsRendering(true)
    // A fresh attempt supersedes whatever the last one reported -- if this
    // one fails too the catch branch below sets a new error right back.
    setError(null)

    // True once this specific commit's result is no longer the one that
    // should land: either a newer commit has since started, or the
    // document itself has since been swapped out from under it (the
    // reset-on-doc-change block above already cleared bytes for whatever
    // replaced it, and this stale result must never overwrite that).
    const isStale = () =>
      latestRequestId.current !== requestId || docRef.current?.id !== currentDoc.id

    const pending: Promise<Uint8Array | null> = (async () => {
      try {
        const fonts = await loadFontBytes()
        const base = lastOutput.current
        const result =
          base && base.docId === currentDoc.id
            ? await renderPdfIncremental(base.bytes, currentSlots, fonts)
            : await renderPdf(currentDoc, currentSlots, fonts)
        if (isStale()) return null
        lastOutput.current = { docId: currentDoc.id, bytes: result, slots: currentSlots }
        setBytes(result)
        setRenderedSlots(currentSlots)
        setIsRendering(false)
        return result
      } catch (err) {
        if (isStale()) return null
        setIsRendering(false)
        // Deliberately does NOT touch bytes/renderedSlots: the previous
        // successful render (if any) stays the one that's painted and
        // considered "committed", so a failed edit keeps its DOM text
        // visible (see Editor.tsx's isSlotCommitted) instead of vanishing.
        setError(err instanceof Error ? err : new Error(String(err)))
        console.error('Failed to render PDF', err)
        return null
      }
    })()

    // Assigned after the IIFE is constructed but before any of its
    // continuations can run (the first `await` inside it yields at least a
    // microtask), so `flush()` can never observe a gap where a render is
    // running with nothing recorded here.
    inFlight.current = pending
    void pending.then(() => {
      if (inFlight.current === pending) inFlight.current = null
    })
    return pending
  }, [])

  const commit = useCallback(() => {
    if (renderOnCommit) void start()
  }, [renderOnCommit, start])

  const render = useCallback(async (): Promise<Uint8Array | null> => {
    // Loops rather than awaiting once: a commit that lands while we're
    // waiting replaces `inFlight.current`, and the newer render is the one
    // to settle on. Terminates because each iteration awaits a promise
    // that is already running and commits only come from user
    // interactions, which cannot fire while this microtask chain drains.
    while (inFlight.current) {
      const pending = inFlight.current
      await pending
      if (inFlight.current === pending) break
    }
    const current = lastOutput.current
    if (current && current.docId === docRef.current?.id && current.slots === slotsRef.current) {
      return current.bytes
    }
    return start()
  }, [start])

  return { bytes, isRendering, renderedSlots, error, commit, render }
}
