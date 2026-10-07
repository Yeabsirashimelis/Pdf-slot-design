'use client'

import { useState } from 'react'

/**
 * The resolved values of some `--token`s from globals.css, for code that
 * paints to a <canvas> and so cannot say `var(--token)` itself. Read once,
 * when the component first renders on the client -- the theme is static.
 * On the server, and in jsdom (where custom properties resolve to ''),
 * the fallbacks given are used, so a paint is never transparent. Nothing
 * rendered depends on the values, so server and client markup agree.
 */
export function useThemeTokens<K extends string>(fallbacks: Record<K, string>): Record<K, string> {
  const [tokens] = useState(() => {
    if (typeof document === 'undefined') return fallbacks
    const styles = getComputedStyle(document.documentElement)
    const resolved = {} as Record<K, string>
    for (const name of Object.keys(fallbacks) as K[]) {
      const value = styles.getPropertyValue(name).trim()
      resolved[name] = value === '' ? fallbacks[name] : value
    }
    return resolved
  })
  return tokens
}
