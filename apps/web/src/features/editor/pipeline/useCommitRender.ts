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
  commit(): void
} {
  const [bytes, setBytes] = useState<Uint8Array | null>(null)
  const [isRendering, setIsRendering] = useState(false)

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
    setIsRendering(false)
  }, [docId])

  const commit = useCallback(() => {
    const currentDoc = docRef.current
    if (!currentDoc) return

    const requestId = ++latestRequestId.current
    const currentSlots = slotsRef.current
    setIsRendering(true)

    void (async () => {
      try {
        const fonts = await loadFontBytes()
        const result = await renderPdf(currentDoc, currentSlots, fonts)
        // A newer commit landed first; this result is stale and must never
        // overwrite it.
        if (latestRequestId.current !== requestId) return
        setBytes(result)
        setIsRendering(false)
      } catch (err) {
        if (latestRequestId.current !== requestId) return
        setIsRendering(false)
        console.error('Failed to render PDF', err)
      }
    })()
  }, [])

  return { bytes, isRendering, commit }
}
