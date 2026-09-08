import { flushSync } from 'react-dom'
import type { Slot } from '@pdf-slot/core'

/**
 * The subset of `EditorStore` a slot command needs. Typed narrowly (rather
 * than importing `EditorStore` itself) so this module has no dependency on
 * `useEditorStore.ts` beyond the two functions it actually calls -- and so
 * a test can pass a plain object instead of standing up the real store.
 */
export type SlotMutations = {
  updateSlot(id: string, patch: Partial<Slot>): void
  removeSlot(id: string): void
}

export type SlotCommands = {
  updateSlotAndCommit(id: string, patch: Partial<Slot>): void
  removeSlotAndCommit(id: string): void
}

/**
 * Builds the two combined "mutate the store, then commit" callbacks
 * Toolbar's per-slot controls (font/size/colour/align/delete) call.
 *
 * Toolbar's controls change a slot and commit in the very same click
 * handler, with no render in between -- unlike SlotOverlay's
 * onChange/onCommit, which are always separated by further
 * keystroke/pointermove renders that naturally refresh useCommitRender's
 * internal ref before onCommit fires. React batches the state update from
 * store.updateSlot/removeSlot, so without forcing a synchronous render
 * here, `commitAndRender()` would run before that update is reflected in
 * the store's own `slots` -- the PDF would render from the slots as they
 * were *before* the click. For delete this is worse than stale: the async
 * render that was launched still contains the deleted slot, and overwrites
 * the previewed bytes with it once it resolves, even though the overlay
 * has already dropped it.
 *
 * `flushSync` forces the state update (and the owning component's
 * re-render) to happen before `commitAndRender` reads anything -- the same
 * fix Editor.tsx's keyboard undo/redo already uses. Pulled out of Editor.tsx
 * into its own module so this exact logic -- not a reimplementation of it --
 * can be exercised directly against a real store and a real
 * `useCommitRender`, without needing to mount the rest of Editor (canvas,
 * pdf.js, font loading) just to prove the commit timing is correct. See
 * test/slotCommands.test.ts.
 */
export function createSlotCommands(store: SlotMutations, commitAndRender: () => void): SlotCommands {
  return {
    updateSlotAndCommit(id, patch) {
      flushSync(() => {
        store.updateSlot(id, patch)
      })
      commitAndRender()
    },
    removeSlotAndCommit(id) {
      flushSync(() => {
        store.removeSlot(id)
      })
      commitAndRender()
    },
  }
}
