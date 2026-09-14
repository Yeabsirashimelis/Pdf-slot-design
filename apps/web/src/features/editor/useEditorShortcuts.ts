'use client'

import { useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'

/**
 * The editor's keyboard shortcuts, on `window`:
 *
 * - Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z: undo / redo. Ignored while a slot's
 *   textarea is focused, so the input's own native undo (e.g. undoing an
 *   IME composition) isn't fought over. `commit()` reads the slots through
 *   a ref that useCommitRender syncs in an effect, so the store update is
 *   flushed synchronously first -- otherwise a commit right after undo
 *   would still see the pre-undo slots.
 * - Ctrl/Cmd+D: duplicate the selected slot (the browser's bookmark
 *   shortcut is suppressed).
 * - Arrow keys: nudge the selected slot 1pt (Shift: 10pt). Screen down is
 *   PDF y down, so ArrowDown passes a negative dy. Ignored while typing
 *   in a textarea, where the arrows move the caret.
 *
 * `duplicateSelected` and `nudgeSelected` are read through refs so the
 * listener never goes stale without being re-registered per render.
 */
/** Arrow key -> (dx, dy) in PDF points per step; PDF y grows upward. */
const ARROWS: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
}

export function useEditorShortcuts({
  undo,
  redo,
  commit,
  duplicateSelected,
  nudgeSelected,
}: {
  undo(): void
  redo(): void
  commit(): void
  duplicateSelected(): void
  nudgeSelected(dx: number, dy: number): void
}): void {
  const duplicateRef = useRef(duplicateSelected)
  const nudgeRef = useRef(nudgeSelected)
  useEffect(() => {
    duplicateRef.current = duplicateSelected
    nudgeRef.current = nudgeSelected
  })

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const arrow = ARROWS[event.key]
      if (arrow && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return
        event.preventDefault()
        const step = event.shiftKey ? 10 : 1
        nudgeRef.current(arrow[0] * step, arrow[1] * step)
        return
      }
      const isModified = event.metaKey || event.ctrlKey
      if (!isModified) return
      if (event.key.toLowerCase() === 'd') {
        event.preventDefault()
        duplicateRef.current()
        return
      }
      if (event.key.toLowerCase() !== 'z') return
      if (event.target instanceof HTMLTextAreaElement) return
      event.preventDefault()
      flushSync(() => {
        if (event.shiftKey) redo()
        else undo()
      })
      commit()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo, commit])
}
