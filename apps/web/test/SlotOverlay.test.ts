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

  it('every slot shows a wash and a hairline; highlighted uses the stronger wash', () => {
    const plain = renderOverlay(false).box
    expect(plain.style.backgroundColor).toContain('var(--slot-highlight)')
    expect(plain.style.boxShadow).toContain('inset')
    cleanup()
    const { box } = renderOverlay(false, { highlighted: true })
    expect(box.style.backgroundColor).toContain('var(--slot-highlight-strong)')
    expect(box.style.boxShadow).toContain('inset')
  })

  it('selected and unlocked: a grab strip on each of the four edges; none when locked', () => {
    const { box } = renderOverlay(true)
    const edges = Array.from(box.querySelectorAll('[data-resize-edge]')).map((el) => el.getAttribute('data-resize-edge'))
    expect(edges.sort()).toEqual(['bottom', 'left', 'right', 'top'])
    cleanup()
    const lockedBox = renderOverlay(true, { locked: true }).box
    expect(lockedBox.querySelectorAll('[data-resize-edge]').length).toBe(0)
  })

  it('dragging the bottom edge reports a height patch; dragging the left edge reports x and width', () => {
    const onChange = vi.fn()
    const { box } = renderOverlay(true, { onChange })
    const bottom = box.querySelector('[data-resize-edge="bottom"]') as HTMLElement
    fireEvent.pointerDown(bottom, { pointerId: 7, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(bottom, { pointerId: 7, clientX: 0, clientY: 30 })
    expect(onChange).toHaveBeenLastCalledWith({ height: expect.any(Number) })
    // At zoom 1 the drag is 30pt; the box started at its text height, so
    // the new height is text height + 30.
    const height = (onChange.mock.calls.at(-1)![0] as { height: number }).height
    expect(height).toBeGreaterThan(30)
    fireEvent.pointerUp(bottom, { pointerId: 7 })

    onChange.mockClear()
    const left = box.querySelector('[data-resize-edge="left"]') as HTMLElement
    fireEvent.pointerDown(left, { pointerId: 8, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(left, { pointerId: 8, clientX: 10, clientY: 0 })
    expect(onChange).toHaveBeenLastCalledWith({ x: 20, width: 190 })
  })

  it('a stored height taller than the text makes the box that tall', () => {
    const { box } = renderOverlay(false, { slot: { ...makeSlot(), height: 120 } })
    expect(box.style.height).toBe('120px')
  })

  it('shows its name as a small label above the box when given one', () => {
    const { box } = renderOverlay(false, { label: 'Date' })
    const label = box.querySelector('[data-testid="slot-label"]') as HTMLElement
    expect(label.textContent).toBe('Date')
    // Above the box, not inside it, and never in the way of the pointer.
    expect(label.style.bottom).toBe('100%')
    expect(label.style.pointerEvents).toBe('none')
    cleanup()
    expect(renderOverlay(false).box.querySelector('[data-testid="slot-label"]')).toBeNull()
  })

  it('readOnly: no text box at all -- the box is about where, not what; typed text still shows', () => {
    const { box } = renderOverlay(true, { readOnly: true, slot: { ...makeSlot(), text: 'written earlier' } })
    expect(box.querySelector('textarea')).toBeNull()
    expect(box.textContent).toContain('written earlier')
    // Still movable and resizable: the move cursor and the edge strips remain.
    expect(box.style.cursor).toBe('move')
    expect(box.querySelectorAll('[data-resize-edge]').length).toBe(4)
  })

  it('Alt+drag leaves the box where it is and moves a copy: the clone is asked for once, then patches target it', () => {
    const onChange = vi.fn()
    const onCloneStart = vi.fn(() => 'copy-1')
    const { box } = renderOverlay(true, { onChange, onCloneStart })
    fireEvent.pointerDown(box, { pointerId: 1, clientX: 0, clientY: 0, altKey: true })
    fireEvent.pointerMove(box, { pointerId: 1, clientX: 30, clientY: 0, altKey: true })
    fireEvent.pointerMove(box, { pointerId: 1, clientX: 40, clientY: 0, altKey: true })
    expect(onCloneStart).toHaveBeenCalledTimes(1)
    // At zoom 1 a 40px drag is 40pt; every patch names the copy, never this slot.
    expect(onChange.mock.calls.every(([, id]) => id === 'copy-1')).toBe(true)
    expect(onChange).toHaveBeenLastCalledWith({ x: 50, y: 700 }, 'copy-1')
    fireEvent.pointerUp(box, { pointerId: 1 })
  })

  it('a plain drag (no Alt) never asks for a clone and patches this slot', () => {
    const onChange = vi.fn()
    const onCloneStart = vi.fn(() => 'copy-1')
    const { box } = renderOverlay(true, { onChange, onCloneStart })
    fireEvent.pointerDown(box, { pointerId: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(box, { pointerId: 1, clientX: 30, clientY: 0 })
    expect(onCloneStart).not.toHaveBeenCalled()
    expect(onChange).toHaveBeenLastCalledWith({ x: 40, y: 700 })
  })

  it('the text box stays selectable even though the stage around it is not', () => {
    const { textarea } = renderOverlay(true)
    expect(textarea.style.userSelect).toBe('text')
  })
})
