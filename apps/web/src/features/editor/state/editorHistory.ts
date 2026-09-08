import type { Slot } from '@pdf-slot/core'

/**
 * Pure undo/redo state machine for the slot list. Kept framework-free (no
 * React) so it is directly unit-testable -- see
 * apps/web/test/editorHistory.test.ts -- and so useEditorStore.ts can stay a
 * thin `useState` wrapper around it.
 *
 * `pendingBefore` is what makes a multi-keystroke text edit or a
 * multi-pointermove drag collapse into a single undo entry: the FIRST
 * `applyUpdateSlot` call in a gesture captures the pre-gesture snapshot
 * there and every call after it (until `applyCommitEdit`) only replaces
 * `present` -- `past`/`future` are untouched in between. `applyCommitEdit`
 * (called once, at pointerup or textarea blur) is what actually pushes that
 * captured snapshot onto `past`, closing the undo boundary.
 */
export type HistoryState = {
  past: Slot[][]
  present: Slot[]
  future: Slot[][]
  /** Snapshot of `present` from just before the in-flight edit/drag began, or null if none is in flight. */
  pendingBefore: Slot[] | null
}

/** Per the brief: undo history is capped at 50 entries. */
export const HISTORY_CAP = 50

export function createHistory(initial: Slot[] = []): HistoryState {
  return { past: [], present: initial, future: [], pendingBefore: null }
}

function pushCapped(past: Slot[][], snapshot: Slot[]): Slot[][] {
  const next = [...past, snapshot]
  return next.length > HISTORY_CAP ? next.slice(next.length - HISTORY_CAP) : next
}

/**
 * Close out any in-flight edit/drag by pushing its pre-gesture snapshot
 * onto `past`. A no-op if nothing is in flight. Every entry point that
 * starts a *new* discrete undo step (add, remove, undo, redo, and
 * `applyCommitEdit` itself) calls this first, so an edit left uncommitted
 * is never silently lost or merged into an unrelated later step.
 */
function flush(state: HistoryState): HistoryState {
  if (state.pendingBefore === null) return state
  return {
    past: pushCapped(state.past, state.pendingBefore),
    present: state.present,
    future: [],
    pendingBefore: null,
  }
}

export function applyAddSlot(state: HistoryState, slot: Slot): HistoryState {
  const flushed = flush(state)
  return {
    past: pushCapped(flushed.past, flushed.present),
    present: [...flushed.present, slot],
    future: [],
    pendingBefore: null,
  }
}

export function applyRemoveSlot(state: HistoryState, id: string): HistoryState {
  const flushed = flush(state)
  return {
    past: pushCapped(flushed.past, flushed.present),
    present: flushed.present.filter((slot) => slot.id !== id),
    future: [],
    pendingBefore: null,
  }
}

/**
 * Live-updates `present` (so every keystroke/pointermove renders
 * immediately) without touching `past`/`future` beyond capturing the
 * pre-gesture snapshot on the first call of a batch. Call
 * `applyCommitEdit` once the gesture ends to turn that batch into one undo
 * entry.
 */
export function applyUpdateSlot(state: HistoryState, id: string, patch: Partial<Slot>): HistoryState {
  const pendingBefore = state.pendingBefore ?? state.present
  const present = state.present.map((slot) => (slot.id === id ? { ...slot, ...patch } : slot))
  return { ...state, present, pendingBefore }
}

export function applyCommitEdit(state: HistoryState): HistoryState {
  return flush(state)
}

export function applyUndo(state: HistoryState): HistoryState {
  const flushed = flush(state)
  const previous = flushed.past[flushed.past.length - 1]
  if (!previous) return flushed
  return {
    past: flushed.past.slice(0, -1),
    present: previous,
    future: [flushed.present, ...flushed.future],
    pendingBefore: null,
  }
}

export function applyRedo(state: HistoryState): HistoryState {
  const flushed = flush(state)
  const [next, ...rest] = flushed.future
  if (!next) return flushed
  return {
    past: pushCapped(flushed.past, flushed.present),
    present: next,
    future: rest,
    pendingBefore: null,
  }
}

export function canUndo(state: HistoryState): boolean {
  return state.past.length > 0 || state.pendingBefore !== null
}

export function canRedo(state: HistoryState): boolean {
  return state.future.length > 0
}
