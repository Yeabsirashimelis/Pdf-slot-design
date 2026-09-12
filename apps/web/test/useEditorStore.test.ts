import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useEditorStore } from '@/features/editor/state/useEditorStore'

describe('useEditorStore: new slots take the last-used style', () => {
  afterEach(() => localStorage.clear())

  it('a fresh store starts new slots with the defaults', () => {
    const { result } = renderHook(() => useEditorStore())
    act(() => result.current.addSlot({ x: 10, y: 700 }, 0))
    expect(result.current.slots[0]).toMatchObject({
      fontId: 'sans', size: 14, color: { r: 0, g: 0, b: 0 }, align: 'left',
    })
  })

  it('after the user restyles a slot, the next slot is born with that style', () => {
    const { result } = renderHook(() => useEditorStore())
    act(() => result.current.addSlot({ x: 10, y: 700 }, 0))
    const first = result.current.slots[0]!
    act(() => result.current.updateSlot(first.id, { fontId: 'serif-bold', size: 18 }))
    act(() => result.current.updateSlot(first.id, { color: { r: 0.1, g: 0.2, b: 0.9 } }))
    // Typing is not a style choice and must not disturb it.
    act(() => result.current.updateSlot(first.id, { text: 'hello' }))

    act(() => result.current.addSlot({ x: 50, y: 600 }, 0))
    expect(result.current.slots[1]).toMatchObject({
      fontId: 'serif-bold', size: 18, color: { r: 0.1, g: 0.2, b: 0.9 }, align: 'left', text: '',
    })
  })

  it('the remembered style outlives the store -- a reload or "start over" keeps it', () => {
    const a = renderHook(() => useEditorStore())
    act(() => a.result.current.addSlot({ x: 10, y: 700 }, 0))
    act(() => a.result.current.updateSlot(a.result.current.slots[0]!.id, { align: 'center', size: 24 }))
    a.unmount()

    const b = renderHook(() => useEditorStore())
    act(() => b.result.current.addSlot({ x: 10, y: 700 }, 0))
    expect(b.result.current.slots[0]).toMatchObject({ align: 'center', size: 24, fontId: 'sans' })
  })
})
