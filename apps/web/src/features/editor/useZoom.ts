'use client'

import { useCallback, useRef, useState } from 'react'
import type { EditorDocument } from '@pdf-slot/core'
import { clampZoom } from './toolbar/ZoomControls'

/**
 * Zoom has two parts. `baseZoom` is fit-width -- the CSS px per PDF point
 * at which the first page fills the column -- measured once per document
 * when the editor's root mounts (`rootRef` is a callback ref for exactly
 * that reason: the width can only be measured once the root is in the
 * DOM, and it re-runs when `doc` changes because it is recreated then).
 * `scale` is what the toolbar shows and steps: 1 means "as large as the
 * column allows", which is what a reader expects to see first and what
 * "100%" means here. (Mapping points 1:1 to CSS pixels instead would show
 * a print-sized form with its 6-7pt text at 8-9px -- rendered correctly,
 * but not readable until zoomed.) `zoom` is the effective scale the
 * overlay geometry and the canvas use.
 *
 * Measured on demand, not tracked continuously -- avoids depending on
 * ResizeObserver (unavailable in this project's jsdom) for a value that
 * only matters at mount and when the fit-width button is pressed. The
 * root is a flex item spanning the column, so its clientWidth is the
 * real available width, independent of the canvas's own size.
 */
/** Fit-width for the document's first page in `el`'s column, or null if either can't be measured. */
function measureFitWidth(el: HTMLDivElement | null, doc: EditorDocument): number | null {
  const availableWidth = el?.clientWidth ?? 0
  const pageWidth = doc.pages[0]?.width ?? 0
  if (availableWidth <= 0 || pageWidth <= 0) return null
  return clampZoom(availableWidth / pageWidth)
}

export function useZoom(doc: EditorDocument): {
  zoom: number
  scale: number
  setScale(scale: number): void
  /** Re-measures (the column may have been resized) and returns to 100%. */
  fitWidth(): void
  /** Attach to the editor's root element. */
  rootRef(el: HTMLDivElement | null): void
} {
  const [scale, setScale] = useState(1)
  const [baseZoom, setBaseZoom] = useState(1)
  const rootEl = useRef<HTMLDivElement | null>(null)
  const fittedForDocIdRef = useRef<string | null>(null)

  const rootRef = useCallback(
    (el: HTMLDivElement | null) => {
      rootEl.current = el
      if (!el || fittedForDocIdRef.current === doc.id) return
      fittedForDocIdRef.current = doc.id
      const fit = measureFitWidth(el, doc)
      if (fit !== null) setBaseZoom(fit)
    },
    [doc],
  )

  const fitWidth = () => {
    const fit = measureFitWidth(rootEl.current, doc)
    if (fit === null) return
    setBaseZoom(fit)
    setScale(1)
  }

  return { zoom: scale * baseZoom, scale, setScale: (s) => setScale(clampZoom(s)), fitWidth, rootRef }
}
