'use client'

import { useEffect, useState } from 'react'

/**
 * `value`, but only once it has held still for `delayMs`. The first value
 * comes through at once; every later change restarts the timer. Used to
 * keep a pinch-zoom from re-rendering the page on every one of its few
 * hundred events -- the stage is CSS-scaled live, and only the settled
 * scale is worth a fresh pdf.js paint.
 */
export function useSettledValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    if (Object.is(value, settled)) return
    const timer = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, settled, delayMs])
  return settled
}
