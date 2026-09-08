'use client'

import { useCallback, useState } from 'react'
import type { Align, FontId, Point, RGB, Slot } from '@pdf-slot/core'
import {
  applyAddSlot,
  applyCommitEdit,
  applyRedo,
  applyRemoveSlot,
  applyUndo,
  applyUpdateSlot,
  canRedo as computeCanRedo,
  canUndo as computeCanUndo,
  createHistory,
  type HistoryState,
} from './editorHistory'

/** Defaults for a freshly placed slot, per the task brief. */
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

export type EditorStore = {
  slots: Slot[]
  selectedId: string | null
  addSlot(atPdf: Point, page: number): void
  updateSlot(id: string, patch: Partial<Slot>): void
  removeSlot(id: string): void
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
      id: crypto.randomUUID(),
      page,
      x: atPdf.x,
      y: atPdf.y,
      text: '',
      ...NEW_SLOT_DEFAULTS,
    }
    setHistory((state) => applyAddSlot(state, slot))
    setSelectedId(slot.id)
  }, [])

  const updateSlot = useCallback((id: string, patch: Partial<Slot>) => {
    setHistory((state) => applyUpdateSlot(state, id, patch))
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
    updateSlot,
    removeSlot,
    select,
    commitEdit,
    undo,
    redo,
    canUndo: computeCanUndo(history),
    canRedo: computeCanRedo(history),
  }
}
