import type { Slot, TemplateTable } from '@pdf-slot/core'

/**
 * Pure undo/redo state machine for everything on the page. Kept
 * framework-free (no React) so it is directly unit-testable -- see
 * apps/web/test/editorHistory.test.ts -- and so useEditorStore.ts can stay a
 * thin `useState` wrapper around it.
 *
 * `pendingBefore` is what makes a multi-keystroke text edit or a
 * multi-pointermove drag collapse into a single undo entry: the FIRST
 * `applyEdit` call in a gesture captures the pre-gesture snapshot
 * there and every call after it (until `applyCommitEdit`) only replaces
 * `present` -- `past`/`future` are untouched in between. `applyCommitEdit`
 * (called once, at pointerup or textarea blur) is what actually pushes that
 * captured snapshot onto `past`, closing the undo boundary.
 */

/**
 * Everything one undo step restores.
 *
 * Tables are in here with the hand-placed slots, not beside them. A
 * cell's position is worked out from its table, so the two have to move
 * back together: a history that remembered the cells but not the table
 * they came from could put a cell where its table no longer says it is.
 * Holding all three in one snapshot makes that impossible to express.
 */
export type EditorSnapshot = {
  slots: Slot[]
  tables: TemplateTable[]
  /** What is typed in each table cell, by the cell's derived id. */
  texts: Record<string, string>
}

export type HistoryState = {
  past: EditorSnapshot[]
  present: EditorSnapshot
  future: EditorSnapshot[]
  /** Snapshot of `present` from just before the in-flight edit/drag began, or null if none is in flight. */
  pendingBefore: EditorSnapshot | null
}

/** Per the brief: undo history is capped at 50 entries. */
export const HISTORY_CAP = 50

export const EMPTY_SNAPSHOT: EditorSnapshot = { slots: [], tables: [], texts: {} }

/** A snapshot from whichever parts of one you have. */
export function snapshot(parts: Partial<EditorSnapshot> = {}): EditorSnapshot {
  return { ...EMPTY_SNAPSHOT, ...parts }
}

export function createHistory(initial: Partial<EditorSnapshot> = {}): HistoryState {
  return { past: [], present: snapshot(initial), future: [], pendingBefore: null }
}

function pushCapped(past: EditorSnapshot[], entry: EditorSnapshot): EditorSnapshot[] {
  const next = [...past, entry]
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

/**
 * One whole step, closed the moment it is made: what `past` gets is the
 * state before it. Adding a slot, dropping a row, throwing a table away
 * -- things a person does once and expects one Ctrl+Z to undo.
 */
export function applyStep(state: HistoryState, change: Partial<EditorSnapshot>): HistoryState {
  const flushed = flush(state)
  return {
    past: pushCapped(flushed.past, flushed.present),
    present: { ...flushed.present, ...change },
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
export function applyEdit(state: HistoryState, change: Partial<EditorSnapshot>): HistoryState {
  const pendingBefore = state.pendingBefore ?? state.present
  return { ...state, present: { ...state.present, ...change }, pendingBefore }
}

export function applyAddSlot(state: HistoryState, slot: Slot): HistoryState {
  return applyStep(state, { slots: [...state.present.slots, slot] })
}

export function applyRemoveSlot(state: HistoryState, id: string): HistoryState {
  return applyStep(state, { slots: state.present.slots.filter((slot) => slot.id !== id) })
}

export function applyUpdateSlot(state: HistoryState, id: string, patch: Partial<Slot>): HistoryState {
  return applyEdit(state, {
    slots: state.present.slots.map((slot) => (slot.id === id ? { ...slot, ...patch } : slot)),
  })
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

/**
 * Install a whole new page and forget the history: opening a file is a
 * boundary undo must not cross -- Ctrl+Z in one document never reaches
 * back into another.
 */
export function applyReplace(_state: HistoryState, next: Partial<EditorSnapshot>): HistoryState {
  return createHistory(next)
}

export function canUndo(state: HistoryState): boolean {
  return state.past.length > 0 || state.pendingBefore !== null
}

export function canRedo(state: HistoryState): boolean {
  return state.future.length > 0
}
