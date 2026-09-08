'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { renderPdf, type EditorDocument, type Slot } from '@pdf-slot/core'
import { loadFontBytes } from '@/lib/fonts/loadFonts'

/**
 * Re-renders the real output PDF on commit boundaries (blur / drag-or-resize
 * end) -- never on a timer -- and hands back the exact bytes to preview and
 * download. See task-16-brief.md: preview becomes a picture of the actual
 * download, rather than an approximation of it.
 */
export function useCommitRender(
  doc: EditorDocument | null,
  slots: Slot[],
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
  commit(): void
} {
  const [bytes, setBytes] = useState<Uint8Array | null>(null)
  const [isRendering, setIsRendering] = useState(false)
  const [renderedSlots, setRenderedSlots] = useState<Slot[] | null>(null)
  const [error, setError] = useState<Error | null>(null)

  // commit() is handed to blur/pointerup handlers as a stable callback (see
  // Editor.tsx), so it can't close over `doc`/`slots` as dependencies without
  // being recreated every render. These refs are updated on every render
  // instead, so commit() always reads the latest values without itself
  // changing identity.
  const docRef = useRef(doc)
  const slotsRef = useRef(slots)
  docRef.current = doc
  slotsRef.current = slots

  // Monotonically increasing request id. Renders are async, and a fast user
  // can commit twice before the first finishes -- whichever result's id
  // isn't the latest is discarded, so a slow render can never clobber a
  // newer one and silently desync the preview from what a download would
  // produce.
  const latestRequestId = useRef(0)

  const docId = doc?.id ?? null
  useEffect(() => {
    // A newly loaded document invalidates any render that belongs to the
    // previous one: bump the request id so an in-flight render for the old
    // document can't land, and drop the stale bytes.
    latestRequestId.current += 1
    setBytes(null)
    setRenderedSlots(null)
    setIsRendering(false)
    setError(null)
  }, [docId])

  const commit = useCallback(() => {
    const currentDoc = docRef.current
    if (!currentDoc) return

    const requestId = ++latestRequestId.current
    const currentSlots = slotsRef.current
    setIsRendering(true)
    // A fresh attempt supersedes whatever the last one reported -- if this
    // one fails too the catch branch below sets a new error right back.
    setError(null)

    void (async () => {
      try {
        const fonts = await loadFontBytes()
        const result = await renderPdf(currentDoc, currentSlots, fonts)
        // A newer commit landed first; this result is stale and must never
        // overwrite it.
        if (latestRequestId.current !== requestId) return
        setBytes(result)
        setRenderedSlots(currentSlots)
        setIsRendering(false)
      } catch (err) {
        if (latestRequestId.current !== requestId) return
        setIsRendering(false)
        // Deliberately does NOT touch bytes/renderedSlots: the previous
        // successful render (if any) stays the one that's painted and
        // considered "committed", so a failed edit keeps its DOM text
        // visible (see Editor.tsx's isSlotCommitted) instead of vanishing.
        setError(err instanceof Error ? err : new Error(String(err)))
        console.error('Failed to render PDF', err)
      }
    })()
  }, [])

  return { bytes, isRendering, renderedSlots, error, commit }
}
