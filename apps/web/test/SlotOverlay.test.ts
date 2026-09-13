import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFontMetrics, type Slot } from '@pdf-slot/core'
import { SlotOverlay } from '@/features/editor/overlay/SlotOverlay'

// jsdom doesn't implement the Pointer Capture API used by SlotOverlay's
// pointer handlers.
HTMLElement.prototype.setPointerCapture ??= () => {}

/**
 * The slot box, its transparent textarea, and its SlotLines spans must all
 * share ONE geometry: the textarea's wrap width and row height are what
 * decide where the caret sits, and the spans are what the user reads, so
 * both have to sit on exactly the rectangle `layoutText` was given.
 *
 * jsdom does no layout, so this pins the one CSS fact that decides it: an
 * absolutely positioned child is placed against its parent's *padding
 * box*. A `border` on the slot box -- even a transparent one -- shrinks
 * that padding box by the border width on every side, so a textarea at
 * `inset: 0` becomes 2px narrower and shorter than the slot, wraps a row
 * earlier than `layoutText`, and scrolls internally to keep its caret in
 * view. That internal scroll is the caret/line jump seen on every
 * keystroke that crossed a wrap point.
 */

const metrics = createFontMetrics(
  readFileSync(path.resolve(__dirname, '../public/fonts/PT_Sans-Web-Regular.ttf')),
)

function makeSlot(): Slot {
  return {
    id: 'slot-1',
    page: 0,
    x: 10,
    y: 700,
    width: 200,
    text: 'hello',
    fontId: 'sans',
    size: 14,
    color: { r: 0, g: 0, b: 0 },
    align: 'left',
    lineHeight: 1.2,
  }
}

function renderOverlay(selected: boolean, extra: Partial<Parameters<typeof SlotOverlay>[0]> = {}) {
  const { container } = render(
    createElement(SlotOverlay, {
      slot: makeSlot(),
      viewport: { zoom: 1, pageHeight: 792 },
      metrics,
      selected,
      autoFocus: false,
      onFocused: vi.fn(),
      onSelect: vi.fn(),
      onChange: vi.fn(),
      onCommit: vi.fn(),
      ...extra,
    }),
  )
  const box = container.querySelector('[data-slot-id]') as HTMLElement
  const textarea = box.querySelector('textarea') as HTMLTextAreaElement
  return { box, textarea }
}

describe('SlotOverlay geometry', () => {
  afterEach(() => cleanup())

  it.each([true, false])(
    'draws the selection ring without a border, so the textarea fills the whole slot (selected=%s)',
    (selected) => {
      const { box, textarea } = renderOverlay(selected)
      // No border in either state: a transparent one shrinks the padding
      // box just as much as a visible one does.
      expect(box.style.border).toBe('')
      expect(box.style.borderWidth).toBe('')
      expect(textarea.style.inset).toBe('0px')
      expect(textarea.style.width).toBe('100%')
      expect(textarea.style.height).toBe('100%')
    },
  )

  it('still shows a visible ring when selected, in the theme\'s selection colour', () => {
    const { box } = renderOverlay(true)
    expect(box.style.outline).toContain('var(--slot-selection)')
  })

  it('locked: no resize handle even when selected, text cursor, and dragging does nothing', () => {
    const onChange = vi.fn()
    const { box } = renderOverlay(true, { locked: true, onChange })
    expect(box.style.cursor).toBe('text')
    // The resize handle is the only child div with cursor ew-resize.
    expect(Array.from(box.querySelectorAll('div')).some((d) => d.style.cursor === 'ew-resize')).toBe(false)
    fireEvent.pointerDown(box, { pointerId: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(box, { pointerId: 1, clientX: 40, clientY: 0 })
    fireEvent.pointerUp(box, { pointerId: 1 })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('highlighted: shows a fill and hairline so the user can see where to write', () => {
    const { box } = renderOverlay(false, { highlighted: true })
    expect(box.style.backgroundColor).not.toBe('')
    expect(box.style.boxShadow).toContain('inset')
  })
})
