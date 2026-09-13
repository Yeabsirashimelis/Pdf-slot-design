'use client'

import { useEffect, useRef } from 'react'

/**
 * Debounced "write this value ~1s after it last changed", with a flush on
 * unmount so a tab close never drops the last second of edits. The same
 * shape the old session save had; now one instance per thing persisted
 * (layout in step 1, values in step 2).
 */
export function useDebouncedWrite<T>(value: T, write: (value: T) => Promise<void>, delayMs = 1000): void {
  const pending = useRef<T | null>(null)
  const writeRef = useRef(write)
  useEffect(() => {
    writeRef.current = write
  })
  useEffect(() => {
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
