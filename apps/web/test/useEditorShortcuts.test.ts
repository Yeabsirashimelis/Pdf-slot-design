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
})
