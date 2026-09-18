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
 * - Ctrl/Cmd+C / Ctrl/Cmd+V: copy the selected slot to the in-app
 *   clipboard / paste it. Ignored while a text field is focused, where
 *   they stay the native text copy and paste.
 * - Arrow keys: nudge the selected slot 1pt (Shift: 10pt). Screen down is
 *   PDF y down, so ArrowDown passes a negative dy. Ignored while typing
 *   in a textarea, where the arrows move the caret.
 *
 * The slot actions are read through refs so the listener never goes
 * stale without being re-registered per render.
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
  copySelected,
  pasteCopied,
}: {
  undo(): void
  redo(): void
  commit(): void
  duplicateSelected(): void
  nudgeSelected(dx: number, dy: number): void
  copySelected(): void
  pasteCopied(): void
}): void {
  const actionsRef = useRef({ duplicateSelected, nudgeSelected, copySelected, pasteCopied })
  useEffect(() => {
    actionsRef.current = { duplicateSelected, nudgeSelected, copySelected, pasteCopied }
  })

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const inTextField = event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement
      const arrow = ARROWS[event.key]
      if (arrow && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (inTextField) return
        event.preventDefault()
        const step = event.shiftKey ? 10 : 1
        actionsRef.current.nudgeSelected(arrow[0] * step, arrow[1] * step)
        return
      }
      const isModified = event.metaKey || event.ctrlKey
      if (!isModified) return
      const letter = event.key.toLowerCase()
      if (letter === 'd') {
        event.preventDefault()
        actionsRef.current.duplicateSelected()
        return
      }
      if ((letter === 'c' || letter === 'v') && !inTextField) {
        event.preventDefault()
        if (letter === 'c') actionsRef.current.copySelected()
        else actionsRef.current.pasteCopied()
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
