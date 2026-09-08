import { createElement, useEffect } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorDocument, Slot } from '@pdf-slot/core'

/**
 * Regression coverage for the fix-round-1 finding: Toolbar's per-slot
 * controls (font/size/colour/align/delete) update the store and commit in
 * the SAME synchronous click handler, with no render in between -- unlike
 * SlotOverlay's onChange/onCommit, which are always separated by further
 * keystroke/pointermove renders that naturally refresh useCommitRender's
 * own ref before onCommit fires. React batches the state update from
 * store.updateSlot/removeSlot, so without forcing a synchronous render
 * (slotCommands.ts's `createSlotCommands`, via flushSync), commit() reads
 * useCommitRender's ref one render behind: the canvas/download would show
 * the PRE-edit slots, and a delete would have its removed slot's text
 * reappear once the stale in-flight render resolves and overwrites bytes.
 *
 * Unlike Toolbar.test.ts (mocked collaborators -- proves the toolbar
 * *calls* updateSlotAndCommit/removeSlotAndCommit with the right
 * arguments), this renders the REAL store (useEditorStore) + REAL
 * useCommitRender + REAL Toolbar, wired together through the REAL
 * `createSlotCommands` (the exact function Editor.tsx uses) -- the only
 * way to observe the actual renderPdf timing. Deliberately does NOT mount
 * the rest of Editor (canvas, pdf.js, font-metrics loading): none of that
 * machinery is what this bug lives in, and pulling it in only slows the
 * test down and introduces timing noise unrelated to what's being tested.
 * See task-17-report.md's fix-round-1 section for the confirmed
 * red-then-green run.
 */

const renderPdfMock = vi.fn<(doc: EditorDocument, slots: Slot[], fonts: unknown) => Promise<Uint8Array>>()

vi.mock('@pdf-slot/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pdf-slot/core')>()
  return {
    ...actual,
    renderPdf: (...args: Parameters<typeof renderPdfMock>) => renderPdfMock(...args),
  }
})

vi.mock('../src/lib/fonts/loadFonts', () => ({
  loadFontBytes: () => Promise.resolve({}),
}))

function makeDoc(): EditorDocument {
  return { id: 'doc-1', source: new Uint8Array([1, 2, 3]), pages: [{ width: 612, height: 792 }] }
}

function makeSlot(overrides: Partial<Slot> = {}): Slot {
  return {
    id: 'target-slot',
    page: 0,
    x: 0,
    y: 0,
    width: 200,
    text: 'hi',
    fontId: 'sans',
    size: 14,
    color: { r: 0, g: 0, b: 0 },
    align: 'left',
    lineHeight: 1.2,
    ...overrides,
  }
}

describe('createSlotCommands wired to a real store + real useCommitRender + real Toolbar', () => {
  beforeEach(() => {
    renderPdfMock.mockReset()
    renderPdfMock.mockResolvedValue(new Uint8Array([9, 9, 9]))
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('changing the font via the toolbar renders the NEW fontId, not the pre-edit one', async () => {
    const { useEditorStore } = await import('../src/features/editor/state/useEditorStore')
    const { useCommitRender } = await import('../src/features/editor/pipeline/useCommitRender')
    const { createSlotCommands } = await import('../src/features/editor/pipeline/slotCommands')
    const { Toolbar } = await import('../src/features/editor/toolbar/Toolbar')

    const doc = makeDoc()
    const slot = makeSlot()

    function Harness() {
      const store = useEditorStore([slot])
      // Selects the seeded slot once on mount, standing in for the click
      // that would normally select it -- Toolbar doesn't care how a slot
      // became selected, only that one is. `select` (not `store`, which is
      // a fresh object every render) is the actual stable dependency:
      // useEditorStore memoizes it with useCallback, so this still only
      // runs once.
      const { select } = store
      useEffect(() => {
        select(slot.id)
      }, [select])
      const { bytes, isRendering, commit } = useCommitRender(doc, store.slots)
      const handleCommit = () => {
        store.commitEdit()
        commit()
      }
      const { updateSlotAndCommit, removeSlotAndCommit } = createSlotCommands(store, handleCommit)
      return createElement(Toolbar, {
        doc,
        bytes,
        isRendering,
        slots: store.slots,
        selectedId: store.selectedId,
        updateSlotAndCommit,
        removeSlotAndCommit,
        zoom: 1,
        onZoomChange: () => {},
        onFitWidth: () => {},
        pageIndex: 0,
        pageCount: doc.pages.length,
        onPageChange: () => {},
      })
    }

    render(createElement(Harness))

    await waitFor(() => {
      expect((screen.getByTestId('font-select-trigger') as HTMLButtonElement).disabled).toBe(false)
    })

    fireEvent.click(screen.getByTestId('font-select-trigger'))
    const option = await waitFor(() => screen.getByTestId('font-option-mono'))
    fireEvent.pointerDown(option)
    fireEvent.click(option)

    await waitFor(() => expect(renderPdfMock).toHaveBeenCalledTimes(1))

    const [, renderedSlots] = renderPdfMock.mock.calls[0]
    expect(renderedSlots).toHaveLength(1)
    // Without flushSync (see slotCommands.ts), this is still 'sans' --
    // renderPdf ran against the slots from BEFORE the font change, because
    // commit() read useCommitRender's ref one render behind the click that
    // changed it.
    expect(renderedSlots[0].fontId).toBe('mono')
  })

  it('deleting the selected slot via the toolbar never lets its text reappear from a stale render', async () => {
    const { useEditorStore } = await import('../src/features/editor/state/useEditorStore')
    const { useCommitRender } = await import('../src/features/editor/pipeline/useCommitRender')
    const { createSlotCommands } = await import('../src/features/editor/pipeline/slotCommands')
    const { Toolbar } = await import('../src/features/editor/toolbar/Toolbar')

    const doc = makeDoc()
    const slot = makeSlot()

    function Harness() {
      const store = useEditorStore([slot])
      const { select } = store
      useEffect(() => {
        select(slot.id)
      }, [select])
      const { bytes, isRendering, commit } = useCommitRender(doc, store.slots)
      const handleCommit = () => {
        store.commitEdit()
        commit()
      }
      const { updateSlotAndCommit, removeSlotAndCommit } = createSlotCommands(store, handleCommit)
      return createElement(Toolbar, {
        doc,
        bytes,
        isRendering,
        slots: store.slots,
        selectedId: store.selectedId,
        updateSlotAndCommit,
        removeSlotAndCommit,
        zoom: 1,
        onZoomChange: () => {},
        onFitWidth: () => {},
        pageIndex: 0,
        pageCount: doc.pages.length,
        onPageChange: () => {},
      })
    }

    render(createElement(Harness))

    await waitFor(() => {
      expect((screen.getByTestId('delete-button') as HTMLButtonElement).disabled).toBe(false)
    })

    fireEvent.click(screen.getByTestId('delete-button'))

    await waitFor(() => expect(renderPdfMock).toHaveBeenCalledTimes(1))

    const [, renderedSlots] = renderPdfMock.mock.calls[0]
    // Without flushSync, renderPdf still ran with the deleted slot
    // included -- once that in-flight render resolves it overwrites
    // `bytes` with a PDF that still contains the "deleted" text.
    expect(renderedSlots).toHaveLength(0)
  })
})
