import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useEditorShortcuts } from '@/features/editor/useEditorShortcuts'

const key = (init: KeyboardEventInit & { key: string }, target: EventTarget = window) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))

describe('useEditorShortcuts', () => {
  it('arrow keys nudge by 1pt, Shift+arrow by 10pt; screen down is PDF y down', () => {
    const nudgeSelected = vi.fn()
    renderHook(() => useEditorShortcuts({ undo: vi.fn(), redo: vi.fn(), commit: vi.fn(), duplicateSelected: vi.fn(), nudgeSelected }))
    key({ key: 'ArrowRight' })
    key({ key: 'ArrowDown' })
    key({ key: 'ArrowLeft', shiftKey: true })
    key({ key: 'ArrowUp', shiftKey: true })
    expect(nudgeSelected.mock.calls).toEqual([[1, 0], [0, -1], [-10, 0], [0, 10]])
  })

  it('arrows inside a textarea move the caret, not the slot', () => {
    const nudgeSelected = vi.fn()
    renderHook(() => useEditorShortcuts({ undo: vi.fn(), redo: vi.fn(), commit: vi.fn(), duplicateSelected: vi.fn(), nudgeSelected }))
    const ta = document.createElement('textarea')
    document.body.appendChild(ta)
    key({ key: 'ArrowRight' }, ta)
    expect(nudgeSelected).not.toHaveBeenCalled()
    ta.remove()
  })

  it('Ctrl+Z undoes and commits; Ctrl+Shift+Z redoes; Ctrl+D duplicates', () => {
    const undo = vi.fn(), redo = vi.fn(), commit = vi.fn(), duplicateSelected = vi.fn()
    renderHook(() => useEditorShortcuts({ undo, redo, commit, duplicateSelected, nudgeSelected: vi.fn() }))
    key({ key: 'z', ctrlKey: true })
    key({ key: 'z', ctrlKey: true, shiftKey: true })
    key({ key: 'd', ctrlKey: true })
    expect(undo).toHaveBeenCalledTimes(1)
    expect(redo).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledTimes(2)
    expect(duplicateSelected).toHaveBeenCalledTimes(1)
  })

  it('Delete/Backspace remove, Escape deselects -- but not while typing in a field', () => {
    const deleteSelected = vi.fn(), deselect = vi.fn()
    renderHook(() =>
      useEditorShortcuts({ undo: vi.fn(), redo: vi.fn(), commit: vi.fn(), duplicateSelected: vi.fn(), nudgeSelected: vi.fn(), deleteSelected, deselect }),
    )
    key({ key: 'Delete' })
    key({ key: 'Backspace' })
    key({ key: 'Escape' })
    expect(deleteSelected).toHaveBeenCalledTimes(2)
    expect(deselect).toHaveBeenCalledTimes(1)

    const input = document.createElement('input')
    document.body.appendChild(input)
    key({ key: 'Backspace' }, input)
    key({ key: 'Escape' }, input)
    expect(deleteSelected).toHaveBeenCalledTimes(2)
    expect(deselect).toHaveBeenCalledTimes(1)
    input.remove()
  })

  it('Ctrl/Cmd + = / − / 0 zoom in, out and to fit, and keep the browser from zooming the page', () => {
    const zoomIn = vi.fn(), zoomOut = vi.fn(), zoomFit = vi.fn()
    renderHook(() =>
      useEditorShortcuts({ undo: vi.fn(), redo: vi.fn(), commit: vi.fn(), duplicateSelected: vi.fn(), nudgeSelected: vi.fn(), zoomIn, zoomOut, zoomFit }),
    )
    const plus = new KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true, cancelable: true })
    window.dispatchEvent(plus)
    key({ key: '+', ctrlKey: true, shiftKey: true })
    key({ key: '-', metaKey: true })
    key({ key: '0', ctrlKey: true })
    expect(plus.defaultPrevented).toBe(true)
    expect(zoomIn).toHaveBeenCalledTimes(2)
    expect(zoomOut).toHaveBeenCalledTimes(1)
    expect(zoomFit).toHaveBeenCalledTimes(1)
    // Without a modifier these keys are just typing.
    key({ key: '-' })
    expect(zoomOut).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+C copies and Ctrl+V pastes the selected slot', () => {
    const copySelected = vi.fn(), pasteCopied = vi.fn()
    renderHook(() =>
      useEditorShortcuts({ undo: vi.fn(), redo: vi.fn(), commit: vi.fn(), duplicateSelected: vi.fn(), nudgeSelected: vi.fn(), copySelected, pasteCopied }),
    )
    key({ key: 'c', ctrlKey: true })
    key({ key: 'v', metaKey: true })
    expect(copySelected).toHaveBeenCalledTimes(1)
    expect(pasteCopied).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+C / Ctrl+V on the canvas act on the slot, even with its own text box focused', () => {
    // A slot's box takes focus the moment it is clicked, so gating on "a
    // field is focused" left no moment when slot copy/paste could fire.
    const copySelected = vi.fn(), pasteCopied = vi.fn()
    renderHook(() =>
      useEditorShortcuts({ undo: vi.fn(), redo: vi.fn(), commit: vi.fn(), duplicateSelected: vi.fn(), nudgeSelected: vi.fn(), copySelected, pasteCopied }),
    )
    const box = document.createElement('div')
    box.setAttribute('data-slot-id', 's1')
    const ta = document.createElement('textarea')
    box.append(ta)
    document.body.append(box)
    key({ key: 'c', ctrlKey: true }, ta)
    key({ key: 'v', ctrlKey: true }, ta)
    expect(copySelected).toHaveBeenCalledTimes(1)
    expect(pasteCopied).toHaveBeenCalledTimes(1)
    box.remove()
  })

  it('Ctrl+C with text highlighted stays the browser\'s copy, wherever it is', () => {
    const copySelected = vi.fn()
    renderHook(() =>
      useEditorShortcuts({ undo: vi.fn(), redo: vi.fn(), commit: vi.fn(), duplicateSelected: vi.fn(), nudgeSelected: vi.fn(), copySelected }),
    )
    const ta = document.createElement('textarea')
    ta.value = 'hello'
    document.body.append(ta)
    ta.setSelectionRange(0, 5)
    expect(key({ key: 'c', ctrlKey: true }, ta)).toBe(true) // not prevented
    expect(copySelected).not.toHaveBeenCalled()
    ta.remove()
  })

  it('Ctrl+C / Ctrl+V inside a panel field stay the native text copy and paste', () => {
    const copySelected = vi.fn(), pasteCopied = vi.fn()
    renderHook(() =>
      useEditorShortcuts({ undo: vi.fn(), redo: vi.fn(), commit: vi.fn(), duplicateSelected: vi.fn(), nudgeSelected: vi.fn(), copySelected, pasteCopied }),
    )
    const panel = document.createElement('aside')
    panel.setAttribute('data-testid', 'slot-panel')
    const ta = document.createElement('textarea')
    const input = document.createElement('input')
    panel.append(ta, input)
    document.body.append(panel)
    expect(key({ key: 'c', ctrlKey: true }, ta)).toBe(true) // not prevented
    expect(key({ key: 'v', ctrlKey: true }, input)).toBe(true)
    expect(copySelected).not.toHaveBeenCalled()
    expect(pasteCopied).not.toHaveBeenCalled()
    panel.remove()
  })
})
