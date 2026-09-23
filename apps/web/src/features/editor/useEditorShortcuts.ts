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
 * - Ctrl/Cmd+C / Ctrl/Cmd+X / Ctrl/Cmd+V: copy, cut or paste the selected
 *   slot through the in-app clipboard. In a side panel they stay the
 *   browser's own text clipboard (see isPanelField).
 * - Ctrl/Cmd+= / Ctrl/Cmd+− / Ctrl/Cmd+0: zoom in / out / to fit (the
 *   browser's own page zoom is suppressed -- the canvas is the thing
 *   being zoomed).
 * - Arrow keys: nudge the selected slot 1pt (Shift: 10pt). Screen down is
 *   PDF y down, so ArrowDown passes a negative dy.
 * - Delete / Backspace: remove the selected slot. Escape: deselect.
 * - ?: the list of every command, with what it does.
 *
 * Arrows, Delete, Backspace and Escape are left alone while typing in a
 * field, where they mean what they always mean.
 *
 * Every handler is read through a ref so the listener never goes stale
 * without being re-registered per render.
 */
/** Arrow key -> (dx, dy) in PDF points per step; PDF y grows upward. */
const ARROWS: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLInputElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

/**
 * A field in one of the side panels (a value box, a name, the hex). There
 * the clipboard is the browser's: Ctrl+C / Ctrl+V move *text*, which is
 * how a value gets pasted in from somewhere else.
 *
 * On the canvas -- including a slot's own box on the page, which takes
 * focus as soon as it is clicked -- they move *slots* instead. Without
 * this split there is no moment when a slot is selected and no field is
 * focused, so slot copy/paste could never fire at all.
 */
function isPanelField(target: EventTarget | null): boolean {
  if (!isTyping(target) || !(target instanceof HTMLElement)) return false
  return target.closest('[data-testid="slot-panel"], [data-testid="inspector-panel"]') !== null
}

/** Text the user has highlighted in the focused field, if any. */
function hasTextSelection(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
    return target.selectionStart !== target.selectionEnd
  }
  return false
}

export type EditorShortcutHandlers = {
  undo(): void
  redo(): void
  commit(): void
  duplicateSelected(): void
  nudgeSelected(dx: number, dy: number): void
  copySelected?(): void
  cutSelected?(): void
  pasteCopied?(): void
  deleteSelected?(): void
  deselect?(): void
  showShortcuts?(): void
  zoomIn?(): void
  zoomOut?(): void
  zoomFit?(): void
}

export function useEditorShortcuts(handlers: EditorShortcutHandlers): void {
  const { undo, redo, commit } = handlers
  const handlersRef = useRef(handlers)
  useEffect(() => {
    handlersRef.current = handlers
  })

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const h = handlersRef.current
      const isModified = event.metaKey || event.ctrlKey

      if (!isModified && !event.altKey) {
        const arrow = ARROWS[event.key]
        if (arrow) {
          if (isTyping(event.target)) return
          event.preventDefault()
          const step = event.shiftKey ? 10 : 1
          h.nudgeSelected(arrow[0] * step, arrow[1] * step)
          return
        }
        if (event.key === 'Delete' || event.key === 'Backspace') {
          if (isTyping(event.target)) return
          event.preventDefault()
          h.deleteSelected?.()
          return
        }
        if (event.key === 'Escape') {
          if (isTyping(event.target)) return
          h.deselect?.()
          return
        }
        if (event.key === '?') {
          if (isTyping(event.target)) return
          event.preventDefault()
          h.showShortcuts?.()
          return
        }
        return
      }
      if (!isModified) return

      switch (event.key) {
        case '=':
        case '+':
          event.preventDefault()
          h.zoomIn?.()
          return
        case '-':
        case '_':
          event.preventDefault()
          h.zoomOut?.()
          return
        case '0':
          event.preventDefault()
          h.zoomFit?.()
          return
      }
      const letter = event.key.toLowerCase()
      if (letter === 'd') {
        event.preventDefault()
        h.duplicateSelected()
        return
      }
      if (letter === 'c' || letter === 'x' || letter === 'v') {
        // In a panel field the clipboard is the browser's (see
        // isPanelField), and a highlighted run of text is always the
        // browser's to copy, wherever it is.
        if (isPanelField(event.target)) return
        if ((letter === 'c' || letter === 'x') && hasTextSelection(event.target)) return
        event.preventDefault()
        if (letter === 'c') h.copySelected?.()
        else if (letter === 'x') h.cutSelected?.()
        else h.pasteCopied?.()
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
