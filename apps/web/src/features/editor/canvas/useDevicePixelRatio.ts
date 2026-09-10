'use client'

import { useSyncExternalStore } from 'react'

function read(): number {
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
}

/**
 * The current `devicePixelRatio`, re-rendering when it changes.
 *
 * There is no `devicePixelRatio` change event; the standard trick is a
 * media query for the *current* ratio, which fires `change` the moment
 * the ratio stops matching (browser zoom, moving the window to a display
 * with different scaling). The query is rebuilt on each change so the
 * listener always watches the ratio that is now in effect.
 */
function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  let query = window.matchMedia(`(resolution: ${read()}dppx)`)
  const handle = () => {
    query.removeEventListener('change', handle)
    query = window.matchMedia(`(resolution: ${read()}dppx)`)
    query.addEventListener('change', handle)
    onChange()
  }
  query.addEventListener('change', handle)
  return () => query.removeEventListener('change', handle)
}

export function useDevicePixelRatio(): number {
  return useSyncExternalStore(subscribe, read, () => 1)
}
