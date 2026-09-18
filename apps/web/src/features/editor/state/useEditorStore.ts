'use client'

import { useCallback, useState } from 'react'
import type { Align, FontId, Point, RGB, Slot } from '@pdf-slot/core'
import { randomId } from '@/lib/files/fileHash'
import {
  applyAddSlot,
  applyCommitEdit,
  applyRedo,
  applyRemoveSlot,
  applyReplace,
  applyUndo,
  applyUpdateSlot,
  canRedo as computeCanRedo,
  canUndo as computeCanUndo,
  createHistory,
  type HistoryState,
} from './editorHistory'
import { recallSlotStyle, rememberSlotStyle, type SlotStyle } from './slotStyleMemory'

/** Defaults for a freshly placed slot, per the task brief -- overridden
 * field by field by whatever style the user last chose (slotStyleMemory). */
const NEW_SLOT_DEFAULTS: {
  width: number
  size: number
  fontId: FontId
  color: RGB
  align: Align
  lineHeight: number
} = {
  width: 200,
  size: 14,
  fontId: 'sans',
  color: { r: 0, g: 0, b: 0 },
  align: 'left',
  lineHeight: 1.2,
}

/** PDF points a duplicate is nudged right and down (PDF Y is up) so it doesn't sit exactly over its source. */
const DUPLICATE_OFFSET = 12

const STYLE_KEYS: readonly (keyof SlotStyle)[] = ['fontId', 'size', 'color', 'align']

function isStyleChange(patch: Partial<Slot>): boolean {
  return STYLE_KEYS.some((key) => key in patch)
}

export type EditorStore = {
  slots: Slot[]
  selectedId: string | null
  addSlot(atPdf: Point, page: number): string
  /**
   * Adds a copy of `id` -- every setting (size, style, colour, alignment,
   * height, text) intact, offset 12pt right and down so it is visibly a
   * second box -- selects it, and returns its id (null if `id` is unknown).
   * One undo step.
   */
  duplicateSlot(id: string): string | null
  /**
   * Adds a slot built from a snapshot (the in-app clipboard: every setting
   * of a slot copied earlier, which may since have been deleted) at the
   * given page and position, selects it, and returns its id. One undo step.
   */
  pasteSlot(snapshot: Slot, target: { page: number; x: number; y: number }): string
  /** Moves a slot by PDF points (y up), as one undo step -- the arrow keys. */
  nudgeSlot(id: string, dx: number, dy: number): void
  updateSlot(id: string, patch: Partial<Slot>): void
  removeSlot(id: string): void
  /**
   * Install a whole new slot list, clearing selection and undo history --
   * used when entering a step (layout <-> write) so undo cannot cross that
   * boundary.
   */
  replaceSlots(slots: Slot[]): void
  select(id: string | null): void
  /**
   * Close the current text-edit or drag/resize gesture, collapsing every
   * `updateSlot` call made since the gesture started into a single undo
   * entry. Not part of the brief's minimal interface, but required by its
   * own undo rule ("push to past ... at the end of a text edit or drag"):
   * something has to tell the store where that end is, since `updateSlot`
   * alone (fired once per keystroke/pointermove) cannot know. Callers
   * (SlotOverlay's pointerup/blur handlers) invoke this once per gesture.
   */
  commitEdit(): void
  undo(): void
  redo(): void
  canUndo: boolean
  canRedo: boolean
}

/**
 * `initialSlots` seeds the undo history's `present` on first mount only --
 * it's how a restored session (Task 18) hands its slots back in without
 * itself being an undo step. Read once, inside useState's lazy initializer;
 * later changes to the argument are ignored, same as any other initial-value
 * prop.
 */
export function useEditorStore(initialSlots: Slot[] = []): EditorStore {
  const [history, setHistory] = useState<HistoryState>(() => createHistory(initialSlots))
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const addSlot = useCallback((atPdf: Point, page: number) => {
    const slot: Slot = {
      id: randomId(),
      page,
      x: atPdf.x,
      y: atPdf.y,
      text: '',
      ...NEW_SLOT_DEFAULTS,
      ...recallSlotStyle(),
    }
    setHistory((state) => applyAddSlot(state, slot))
    setSelectedId(slot.id)
    return slot.id
  }, [])

  const duplicateSlot = useCallback((id: string): string | null => {
    const source = history.present.find((slot) => slot.id === id)
    if (!source) return null
    const copy: Slot = { ...source, id: randomId(), x: source.x + DUPLICATE_OFFSET, y: source.y - DUPLICATE_OFFSET }
    setHistory((state) => applyAddSlot(state, copy))
    setSelectedId(copy.id)
    return copy.id
  }, [history.present])

  const pasteSlot = useCallback((snapshot: Slot, target: { page: number; x: number; y: number }): string => {
    const pasted: Slot = { ...snapshot, id: randomId(), page: target.page, x: target.x, y: target.y }
    setHistory((state) => applyAddSlot(state, pasted))
    setSelectedId(pasted.id)
    return pasted.id
  }, [])

  const nudgeSlot = useCallback((id: string, dx: number, dy: number) => {
    setHistory((state) => {
      const slot = state.present.find((s) => s.id === id)
      if (!slot) return state
      // One undo step per press: update, then close the boundary.
      return applyCommitEdit(applyUpdateSlot(state, id, { x: slot.x + dx, y: slot.y + dy }))
    })
  }, [])

  const updateSlot = useCallback((id: string, patch: Partial<Slot>) => {
    setHistory((state) => {
      const next = applyUpdateSlot(state, id, patch)
      // A style choice (not typing, not a drag) becomes the starting point
      // for the next slot. Read off the updated slot rather than the patch
      // so the remembered style is always a complete, coherent set.
      if (isStyleChange(patch)) {
        const updated = next.present.find((s) => s.id === id)
        if (updated) rememberSlotStyle(updated)
      }
      return next
    })
  }, [])

  const replaceSlots = useCallback((slots: Slot[]) => {
    setHistory((state) => applyReplace(state, slots))
    setSelectedId(null)
  }, [])

  const removeSlot = useCallback((id: string) => {
    setHistory((state) => applyRemoveSlot(state, id))
    setSelectedId((current) => (current === id ? null : current))
  }, [])

  const select = useCallback((id: string | null) => {
    setSelectedId(id)
  }, [])

  const commitEdit = useCallback(() => {
    setHistory((state) => applyCommitEdit(state))
  }, [])

  const undo = useCallback(() => {
    setHistory((state) => applyUndo(state))
  }, [])

  const redo = useCallback(() => {
    setHistory((state) => applyRedo(state))
  }, [])

  return {
    slots: history.present,
    selectedId,
    addSlot,
    duplicateSlot,
    pasteSlot,
    nudgeSlot,
    updateSlot,
    removeSlot,
    replaceSlots,
    select,
    commitEdit,
    undo,
    redo,
    canUndo: computeCanUndo(history),
    canRedo: computeCanRedo(history),
  }
}
