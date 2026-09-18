import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useEditorShortcuts } from '@/features/editor/useEditorShortcuts'

const key = (init: KeyboardEventInit & { key: string }, target: EventTarget = window) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))

type Actions = Parameters<typeof useEditorShortcuts>[0]
const actions = (over: Partial<Actions> = {}): Actions => ({
  undo: vi.fn(), redo: vi.fn(), commit: vi.fn(), duplicateSelected: vi.fn(), nudgeSelected: vi.fn(),
  copySelected: vi.fn(), pasteCopied: vi.fn(), ...over,
})

describe('useEditorShortcuts', () => {
  it('arrow keys nudge by 1pt, Shift+arrow by 10pt; screen down is PDF y down', () => {
    const nudgeSelected = vi.fn()
    renderHook(() => useEditorShortcuts(actions({ nudgeSelected })))
    key({ key: 'ArrowRight' })
    key({ key: 'ArrowDown' })
    key({ key: 'ArrowLeft', shiftKey: true })
    key({ key: 'ArrowUp', shiftKey: true })
    expect(nudgeSelected.mock.calls).toEqual([[1, 0], [0, -1], [-10, 0], [0, 10]])
  })

  it('arrows inside a textarea move the caret, not the slot', () => {
    const nudgeSelected = vi.fn()
    renderHook(() => useEditorShortcuts(actions({ nudgeSelected })))
    const ta = document.createElement('textarea')
    document.body.appendChild(ta)
    key({ key: 'ArrowRight' }, ta)
    expect(nudgeSelected).not.toHaveBeenCalled()
    ta.remove()
  })

  it('Ctrl+Z undoes and commits; Ctrl+Shift+Z redoes; Ctrl+D duplicates', () => {
    const undo = vi.fn(), redo = vi.fn(), commit = vi.fn(), duplicateSelected = vi.fn()
    renderHook(() => useEditorShortcuts(actions({ undo, redo, commit, duplicateSelected })))
    key({ key: 'z', ctrlKey: true })
    key({ key: 'z', ctrlKey: true, shiftKey: true })
    key({ key: 'd', ctrlKey: true })
    expect(undo).toHaveBeenCalledTimes(1)
    expect(redo).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledTimes(2)
    expect(duplicateSelected).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+C copies and Ctrl+V pastes the selected slot', () => {
    const copySelected = vi.fn(), pasteCopied = vi.fn()
    renderHook(() => useEditorShortcuts(actions({ copySelected, pasteCopied })))
    key({ key: 'c', ctrlKey: true })
    key({ key: 'v', metaKey: true })
    expect(copySelected).toHaveBeenCalledTimes(1)
    expect(pasteCopied).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+C / Ctrl+V inside a text field stay the native text copy and paste', () => {
    const copySelected = vi.fn(), pasteCopied = vi.fn()
    renderHook(() => useEditorShortcuts(actions({ copySelected, pasteCopied })))
    const ta = document.createElement('textarea')
    const input = document.createElement('input')
    document.body.append(ta, input)
    expect(key({ key: 'c', ctrlKey: true }, ta)).toBe(true) // not prevented
    expect(key({ key: 'v', ctrlKey: true }, input)).toBe(true)
    expect(copySelected).not.toHaveBeenCalled()
    expect(pasteCopied).not.toHaveBeenCalled()
    ta.remove(); input.remove()
  })
})
