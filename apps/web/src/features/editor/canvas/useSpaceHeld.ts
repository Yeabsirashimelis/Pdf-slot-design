'use client'

import { useEffect, useState } from 'react'

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

/**
 * Whether the space bar is held -- Figma's "hand" modifier: while it is,
 * the canvas shows a grab cursor and a left-drag pans instead of touching
 * the slots (the zoom/pan library gates its panning on the same key; this
 * hook is for what the library does not do: the cursor and shielding the
 * slots). A space typed into a field is typing, not the modifier, and a
 * window blur releases it, so a held key never sticks.
 */
export function useSpaceHeld(): boolean {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key !== ' ' || event.repeat || isTyping(event.target)) return
      // The page must not scroll on space while the canvas is in use.
      event.preventDefault()
      setHeld(true)
    }
    const up = (event: KeyboardEvent) => {
      if (event.key === ' ') setHeld(false)
    }
    const release = () => setHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', release)
    }
  }, [])
  return held
}
