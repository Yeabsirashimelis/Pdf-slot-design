import { describe, expect, it } from 'vitest'
import type { Slot } from '@pdf-slot/core'
import {
  HISTORY_CAP,
  applyAddSlot,
  applyCommitEdit,
  applyRedo,
  applyRemoveSlot,
  applyUndo,
  applyUpdateSlot,
  canRedo,
  canUndo,
  createHistory,
  type HistoryState,
} from '../src/features/editor/state/editorHistory'

function makeSlot(overrides: Partial<Slot> = {}): Slot {
  return {
    id: 'slot-1',
    page: 0,
    x: 10,
    y: 700,
    width: 200,
    text: '',
    fontId: 'sans',
    size: 14,
    color: { r: 0, g: 0, b: 0 },
    align: 'left',
    lineHeight: 1.2,
    ...overrides,
  }
}

describe('editorHistory: add / update / remove / select-adjacent semantics', () => {
  it('addSlot appends to present and records one undo step', () => {
    const slot = makeSlot()
    const state = applyAddSlot(createHistory(), slot)

    expect(state.present).toEqual([slot])
    expect(state.past).toEqual([[]])
    expect(canUndo(state)).toBe(true)
  })

  it('removeSlot removes from present and records one undo step', () => {
    const slot = makeSlot()
    const afterAdd = applyAddSlot(createHistory(), slot)
    const afterRemove = applyRemoveSlot(afterAdd, slot.id)

    expect(afterRemove.present).toEqual([])
    expect(afterRemove.past).toEqual([[], [slot]])
  })

  it('updateSlot patches the matching slot in present, leaving others untouched', () => {
    const a = makeSlot({ id: 'a', text: 'hello' })
    const b = makeSlot({ id: 'b', text: 'world' })
    const state: HistoryState = { past: [], present: [a, b], future: [], pendingBefore: null }

    const patched = applyUpdateSlot(state, 'a', { text: 'HELLO' })

    expect(patched.present).toEqual([{ ...a, text: 'HELLO' }, b])
  })

  it('undo after removeSlot restores the removed slot', () => {
    const slot = makeSlot()
    const afterAdd = applyAddSlot(createHistory(), slot)
    const afterRemove = applyRemoveSlot(afterAdd, slot.id)

    const undone = applyUndo(afterRemove)

    expect(undone.present).toEqual([slot])
  })
})

describe('editorHistory: undo boundaries on gestures', () => {
  it('a multi-character text edit collapses into ONE undo entry, not N', () => {
    const slot = makeSlot({ text: '' })
    const afterAdd = applyAddSlot(createHistory(), slot)
    const pastCountAfterAdd = afterAdd.past.length

    // Simulate typing "hello" one keystroke at a time -- five separate
    // updateSlot calls, as SlotOverlay's textarea onChange would produce.
    let state = afterAdd
    for (const partial of ['h', 'he', 'hel', 'hell', 'hello']) {
      state = applyUpdateSlot(state, slot.id, { text: partial })
    }

    // Still in-flight: no new past entries have been pushed yet, only the
    // pending snapshot captured at the first keystroke.
    expect(state.past.length).toBe(pastCountAfterAdd)
    expect(state.present[0]?.text).toBe('hello')

    const committed = applyCommitEdit(state)

    // Exactly one new undo entry for the whole five-keystroke edit.
    expect(committed.past.length).toBe(pastCountAfterAdd + 1)
    expect(committed.present[0]?.text).toBe('hello')

    const undone = applyUndo(committed)
    expect(undone.present[0]?.text).toBe('')
  })

  it('a multi-pointermove drag collapses into ONE undo entry', () => {
    const slot = makeSlot({ x: 0, y: 0 })
    const afterAdd = applyAddSlot(createHistory(), slot)
    const pastCountAfterAdd = afterAdd.past.length

    let state = afterAdd
    for (let i = 1; i <= 10; i++) {
      state = applyUpdateSlot(state, slot.id, { x: i, y: i })
    }
    state = applyCommitEdit(state)

    expect(state.past.length).toBe(pastCountAfterAdd + 1)
    expect(state.present[0]).toMatchObject({ x: 10, y: 10 })

    const undone = applyUndo(state)
    expect(undone.present[0]).toMatchObject({ x: 0, y: 0 })
  })

  it('committing with nothing in flight is a no-op', () => {
    const slot = makeSlot()
    const afterAdd = applyAddSlot(createHistory(), slot)

    const committed = applyCommitEdit(afterAdd)

    expect(committed).toEqual(afterAdd)
  })

  it('calling undo mid-edit (without an explicit commit) still closes the gesture as one step', () => {
    const slot = makeSlot({ text: '' })
    const afterAdd = applyAddSlot(createHistory(), slot)

    let state = afterAdd
    for (const partial of ['a', 'ab', 'abc']) {
      state = applyUpdateSlot(state, slot.id, { text: partial })
    }

    // No explicit commitEdit() call -- undo() itself must flush first.
    const undone = applyUndo(state)

    expect(undone.present[0]?.text).toBe('')
  })
})

describe('editorHistory: undo / redo round trip', () => {
  it('undo then redo restores the edited state', () => {
    const slot = makeSlot({ text: '' })
    let state = applyAddSlot(createHistory(), slot)
    state = applyUpdateSlot(state, slot.id, { text: 'hi' })
    state = applyCommitEdit(state)

    const undone = applyUndo(state)
    expect(undone.present[0]?.text).toBe('')

    const redone = applyRedo(undone)
    expect(redone.present[0]?.text).toBe('hi')
  })

  it('undo with an empty past is a no-op and canUndo is false', () => {
    const state = createHistory([makeSlot()])
    expect(canUndo(state)).toBe(false)
    expect(applyUndo(state)).toEqual(state)
  })

  it('redo with an empty future is a no-op and canRedo is false', () => {
    const state = createHistory([makeSlot()])
    expect(canRedo(state)).toBe(false)
    expect(applyRedo(state)).toEqual(state)
  })

  it('a new action after undo discards the redo future', () => {
    const first = makeSlot({ id: 'a' })
    const second = makeSlot({ id: 'b' })

    let state = applyAddSlot(createHistory(), first)
    state = applyAddSlot(state, second)
    state = applyUndo(state)
    expect(canRedo(state)).toBe(true)

    const third = makeSlot({ id: 'c' })
    state = applyAddSlot(state, third)

    expect(canRedo(state)).toBe(false)
    expect(state.present.map((s) => s.id)).toEqual(['a', 'c'])
  })
})

describe('editorHistory: cap at 50 entries', () => {
  it('past never grows past HISTORY_CAP, dropping the oldest entries first', () => {
    let state = createHistory()
    const overflow = 10
    for (let i = 0; i < HISTORY_CAP + overflow; i++) {
      state = applyAddSlot(state, makeSlot({ id: `slot-${i}` }))
    }

    expect(state.past.length).toBe(HISTORY_CAP)
    expect(state.present.length).toBe(HISTORY_CAP + overflow)

    // The oldest surviving snapshot in `past` is the one taken right before
    // slot `overflow` was added -- i.e. it already contains slots
    // 0..overflow-1 -- proving the earliest snapshots (empty, [slot-0], ...)
    // were the ones dropped, not the most recent ones.
    const oldestSurviving = state.past[0]!
    expect(oldestSurviving.length).toBe(overflow)
    expect(oldestSurviving.map((s) => s.id)).toEqual(
      Array.from({ length: overflow }, (_, i) => `slot-${i}`),
    )
  })
})
