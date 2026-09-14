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

describe('useEditorStore: addSlot return value and replaceSlots', () => {
  it('addSlot returns the id of the slot it created', () => {
    const { result } = renderHook(() => useEditorStore())
    let id = ''
    act(() => {
      id = result.current.addSlot({ x: 10, y: 700 }, 0)
    })
    expect(id).toBe(result.current.slots[0]!.id)
    expect(result.current.selectedId).toBe(id)
  })

  it('replaceSlots installs a new list, clears selection and undo history', () => {
    const { result } = renderHook(() => useEditorStore())
    act(() => { result.current.addSlot({ x: 10, y: 700 }, 0) })
    const fresh = { ...result.current.slots[0]!, id: 'fresh', text: 'hello' }
    act(() => { result.current.replaceSlots([fresh]) })
    expect(result.current.slots).toEqual([fresh])
    expect(result.current.selectedId).toBeNull()
    expect(result.current.canUndo).toBe(false)
  })
})

describe('useEditorStore: duplicateSlot', () => {
  afterEach(() => localStorage.clear())

  it('copies every setting, offsets the copy so it is visible, gives it a new id and selects it', () => {
    const { result } = renderHook(() => useEditorStore())
    act(() => result.current.addSlot({ x: 100, y: 700 }, 0))
    const source = result.current.slots[0]!
    act(() =>
      result.current.updateSlot(source.id, {
        text: 'sample', fontId: 'serif-bold', size: 18, width: 240, height: 60,
        color: { r: 0.1, g: 0.2, b: 0.9 }, align: 'center',
      }),
    )
    let copyId = ''
    act(() => {
      copyId = result.current.duplicateSlot(source.id)!
    })
    expect(copyId).not.toBe(source.id)
    expect(result.current.selectedId).toBe(copyId)
    expect(result.current.slots).toHaveLength(2)
    const copy = result.current.slots[1]!
    expect(copy).toMatchObject({
      id: copyId, page: 0, text: 'sample', fontId: 'serif-bold', size: 18, width: 240, height: 60,
      color: { r: 0.1, g: 0.2, b: 0.9 }, align: 'center', x: 112, y: 688,
    })
  })

  it('returns null for an unknown id and changes nothing', () => {
    const { result } = renderHook(() => useEditorStore())
    let out: string | null = 'x'
    act(() => {
      out = result.current.duplicateSlot('nope')
    })
    expect(out).toBeNull()
    expect(result.current.slots).toHaveLength(0)
  })

  it('is one undo step', () => {
    const { result } = renderHook(() => useEditorStore())
    act(() => result.current.addSlot({ x: 10, y: 700 }, 0))
    act(() => { result.current.duplicateSlot(result.current.slots[0]!.id) })
    expect(result.current.slots).toHaveLength(2)
    act(() => result.current.undo())
    expect(result.current.slots).toHaveLength(1)
  })
})

describe('useEditorStore: nudgeSlot', () => {
  afterEach(() => localStorage.clear())

  it('moves the slot by the given PDF-point deltas as one undo step', () => {
    const { result } = renderHook(() => useEditorStore())
    act(() => result.current.addSlot({ x: 100, y: 700 }, 0))
    const id = result.current.slots[0]!.id
    act(() => result.current.nudgeSlot(id, 1, 0))
    act(() => result.current.nudgeSlot(id, 0, -10))
    expect(result.current.slots[0]).toMatchObject({ x: 101, y: 690 })
    act(() => result.current.undo())
    expect(result.current.slots[0]).toMatchObject({ x: 101, y: 700 })
  })
})
