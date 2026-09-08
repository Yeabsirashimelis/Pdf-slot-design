'use client'

import { useEffect, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'

/**
 * pdf.js renders on a worker thread; without this it falls back to a
 * (deprecated, slower) main-thread path and warns in the console. The
 * `new URL(..., import.meta.url)` form is what Next/Turbopack recognises as
 * a bundled asset reference, so the worker script ships alongside the app
 * instead of needing to be hosted separately.
 *
 * `pdfjs-dist`'s top-level module code only touches `document`/`window`
 * behind `typeof` guards, so importing it -- and this assignment -- is safe
 * during Next's server-side module evaluation; it's the actual document
 * loading and page rendering below that must stay confined to the browser
 * (inside `useEffect`).
 */
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

type LoadState = { bytes: Uint8Array | null; doc: PDFDocumentProxy | null }

/**
 * Load a pdf.js document from raw PDF bytes.
 *
 * Returns `null` while loading, on failure, or when `bytes` is `null`. If
 * `bytes` changes (or the component unmounts) before loading finishes, or
 * after a document has loaded, the in-flight or loaded document is
 * destroyed -- `PDFDocumentLoadingTask.destroy()` handles both cases, so a
 * document is never left running against a worker nobody references
 * anymore.
 *
 * State is keyed by the `bytes` it was loaded for (rather than reset to
 * `null` synchronously inside the effect when `bytes` changes) so the hook
 * never calls `setState` directly in an effect body -- only from the
 * loading task's own callbacks, once the browser has actually finished
 * work for the new bytes.
 */
export function usePdfDocument(bytes: Uint8Array | null): PDFDocumentProxy | null {
  const [state, setState] = useState<LoadState>({ bytes: null, doc: null })

  useEffect(() => {
    if (!bytes) return

    let cancelled = false
    // pdf.js transfers (detaches) the underlying ArrayBuffer of `data` to
    // the worker instead of copying it. Passing `bytes` itself would leave
    // the caller's EditorDocument.source detached after the first load --
    // and throw outright on a second load with the same reference, which
    // happens routinely: React's Strict Mode double-invokes this effect in
    // development, and a real remount with unchanged bytes would hit the
    // exact same "ArrayBuffer is detached" DataCloneError in production.
    // `.slice()` gives this load its own copy to transfer.
    const loadingTask = pdfjs.getDocument({ data: bytes.slice() })

    loadingTask.promise
      .then((pdf) => {
        if (!cancelled) setState({ bytes, doc: pdf })
      })
      .catch(() => {
        if (!cancelled) setState({ bytes, doc: null })
      })

    return () => {
      cancelled = true
      void loadingTask.destroy()
    }
  }, [bytes])

  return state.bytes === bytes ? state.doc : null
}
