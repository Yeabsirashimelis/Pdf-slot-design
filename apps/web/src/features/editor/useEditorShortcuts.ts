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
 *   shortcut is suppressed). `duplicateSelected` is read through a ref so
 *   the listener never goes stale without being re-registered per render.
 */
export function useEditorShortcuts({
  undo,
  redo,
  commit,
  duplicateSelected,
}: {
  undo(): void
  redo(): void
  commit(): void
  duplicateSelected(): void
}): void {
  const duplicateRef = useRef(duplicateSelected)
  useEffect(() => {
    duplicateRef.current = duplicateSelected
  })

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
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
