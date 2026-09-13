'use client'

import { useEffect, useRef } from 'react'

/**
 * Debounced "write this value ~1s after it changes", with a flush on
 * unmount so a tab close never drops the last second of edits. The same
 * shape the old session save had; now one instance per thing persisted
 * (layout in step 1, values in step 2).
 *
 * The value as first mounted is never written: it is what was loaded (or
 * nothing, for a new file), so there is nothing to save yet -- and saving
 * an empty layout would make openFile treat the file as known. Only a
 * change after mount arms a write, and the flush only writes a pending
 * change. "Changed" is judged against the last value this hook saw, not
 * with a first-run flag: StrictMode re-runs the effect on the same
 * instance with the same value, and a flag would mistake that for a
 * change.
 */
export function useDebouncedWrite<T>(value: T, write: (value: T) => Promise<void>, delayMs = 1000): void {
  const pending = useRef<T | null>(null)
  const lastSeen = useRef(value)
  const writeRef = useRef(write)
  useEffect(() => {
    writeRef.current = write
  })
  useEffect(() => {
    if (Object.is(lastSeen.current, value)) return
    lastSeen.current = value
    pending.current = value
    const timer = setTimeout(() => {
      pending.current = null
      void writeRef.current(value)
    }, delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  useEffect(() => {
    const flush = () => {
      if (pending.current === null) return
      const v = pending.current
      pending.current = null
      void writeRef.current(v)
    }
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      flush()
    }
  }, [])
}
