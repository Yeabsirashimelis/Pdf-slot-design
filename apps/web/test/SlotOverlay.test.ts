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

/** The name tag, whether or not it is currently showing. */
function tagOf(box: HTMLElement): HTMLElement {
  return box.querySelector('[data-testid="slot-label"]') as HTMLElement
}

/**
 * The name tag as a user gets hold of it: it only shows while the pointer
 * is on the slot, so every drag starts by hovering it. (React derives
 * onPointerEnter from the pointer's over/out events, which is what a real
 * pointer crossing onto the tag sends.)
 */
function handleOf(box: HTMLElement): HTMLElement {
  const tag = tagOf(box)
  fireEvent.pointerOver(tag)
  return tag
}

/**
 * What the tag actually measures on screen: its stage font size, times
 * the counter-scale it is drawn at, times the stage's own scale.
 */
function tagScreenPx(tag: HTMLElement, screenScale: number): number {
  return parseFloat(tag.style.fontSize) * screenScale
}

function renderOverlay(selected: boolean, extra: Partial<Parameters<typeof SlotOverlay>[0]> = {}) {
  const { container } = render(
    createElement(SlotOverlay, {
      slot: makeSlot(),
      name: 'Field',
      viewport: { zoom: 1, pageHeight: 792 },
      metrics,
      selected,
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

  it('locked: no resize handle even when selected, and the tag no longer drags', () => {
    const onChange = vi.fn()
    const { box } = renderOverlay(true, { locked: true, onChange })
    // The resize handle is the only child div with cursor ew-resize.
    expect(Array.from(box.querySelectorAll('div')).some((d) => d.style.cursor === 'ew-resize')).toBe(false)
    const tag = handleOf(box)
    expect(tag.style.pointerEvents).toBe('none')
    fireEvent.pointerDown(tag, { pointerId: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(tag, { pointerId: 1, clientX: 40, clientY: 0 })
    fireEvent.pointerUp(tag, { pointerId: 1 })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('the box is for text, the tag is for moving: a drag across the box moves nothing', () => {
    const onChange = vi.fn()
    const { box } = renderOverlay(true, { onChange })
    expect(box.style.cursor).toBe('text')
    fireEvent.pointerDown(box, { pointerId: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(box, { pointerId: 1, clientX: 60, clientY: 20 })
    fireEvent.pointerUp(box, { pointerId: 1 })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('dragging the tag moves the slot, and selects it first', () => {
    const onChange = vi.fn()
    const onSelect = vi.fn()
    const { box } = renderOverlay(false, { onChange, onSelect })
    const tag = handleOf(box)
    expect(tag.style.cursor).toBe('move')
    fireEvent.pointerDown(tag, { pointerId: 1, clientX: 0, clientY: 0 })
    expect(onSelect).toHaveBeenCalledTimes(1)
    fireEvent.pointerMove(tag, { pointerId: 1, clientX: 40, clientY: 0 })
    expect(onChange).toHaveBeenLastCalledWith({ x: 50, y: 700 })
    fireEvent.pointerUp(tag, { pointerId: 1 })
  })

  it('every slot shows a wash and a hairline', () => {
    const { box } = renderOverlay(false)
    expect(box.style.backgroundColor).toContain('var(--slot-highlight)')
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
})

describe('SlotOverlay on a scaled stage', () => {
  afterEach(() => cleanup())

  it('divides pointer deltas by the screen scale: a 40px drag on a 2x stage moves the slot 20pt', () => {
    const onChange = vi.fn()
    const { box } = renderOverlay(true, { onChange, screenScale: 2 })
    const tag = handleOf(box)
    fireEvent.pointerDown(tag, { pointerId: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(tag, { pointerId: 1, clientX: 40, clientY: 0 })
    expect(onChange).toHaveBeenLastCalledWith({ x: 10 + 20, y: 700 })
  })

  it('keeps the outline and the grab strips the same size on screen at any zoom', () => {
    const { box } = renderOverlay(true, { screenScale: 4 })
    // 2 screen px of outline is 0.5 stage px on a 4x stage.
    expect(box.style.outline).toContain('0.5px')
    const strip = box.querySelector('[data-resize-edge="right"]') as HTMLElement
    expect(strip.style.width).toBe('2px')
  })
})

describe('SlotOverlay name and size', () => {
  afterEach(() => cleanup())

  it('an empty slot shows its name as a placeholder in its own typography, faded and marked as such', () => {
    const { box } = renderOverlay(false, { slot: { ...makeSlot(), text: '' }, name: 'Date' })
    const spans = box.querySelectorAll('[data-slot-line][data-placeholder]')
    expect(spans.length).toBeGreaterThan(0)
    expect(box.textContent).toContain('Date')
    expect((spans[0] as HTMLElement).style.fontFamily).toBe('PdfSlotSans')
    // In the box's accent, NEVER the slot's ink: in the slot's own colour a
    // name is indistinguishable from text that would be exported.
    expect((spans[0] as HTMLElement).style.color).toContain('--slot-selection')
    expect((spans[0] as HTMLElement).style.color).not.toContain('rgb(')
  })

  it('once named, the slot takes the caret so the next thing typed is its text', () => {
    const onFocused = vi.fn()
    const { box } = renderOverlay(true, { slot: { ...makeSlot(), text: '' }, name: 'Date', autoFocus: true, onFocused })
    expect(document.activeElement).toBe(box.querySelector('textarea'))
    expect(onFocused).toHaveBeenCalledTimes(1)
  })

  it('shows the slot\'s name on a chip above the box, sized to land between its bounds on screen', () => {
    const { box } = renderOverlay(false, { name: 'Date', screenScale: 1.2 })
    const tag = handleOf(box)
    expect(tag.textContent).toBe('Date')
    expect(tag.style.bottom).toBe('100%')
    // Sized, never scaled: a `transform: scale()` rasterises the glyphs at
    // one size and stretches them, which is what left the chip looking
    // pixelated once the page was zoomed in.
    expect(tag.style.transform).toBe('')
    // 11px at 1.2x is 13.2 on screen, inside the bounds: it tracks the page...
    expect(tagScreenPx(tag, 1.2)).toBeCloseTo(13.2, 6)
    cleanup()
    // ...and holds still outside them: readable far out...
    const small = handleOf(renderOverlay(false, { name: 'Date', screenScale: 0.25 }).box)
    expect(tagScreenPx(small, 0.25)).toBeCloseTo(11, 6)
    cleanup()
    // ...and a chip, never a banner, far in.
    const big = handleOf(renderOverlay(false, { name: 'Date', screenScale: 4 }).box)
    expect(tagScreenPx(big, 4)).toBeCloseTo(15, 6)
  })

  it('the tag stays out of the way: hidden until the pointer is on the slot, up while selected or named', () => {
    const { box } = renderOverlay(false, { name: 'Date' })
    const tag = tagOf(box)
    expect(tag.style.opacity).toBe('0')
    // Reaching straight for the handle counts as being on the slot: the
    // tag's own strip above the box is part of what it hovers.
    fireEvent.pointerOver(tag)
    expect(tag.style.opacity).toBe('1')
    fireEvent.pointerOut(box)
    expect(tag.style.opacity).toBe('0')
    // The box itself shows it too -- that is how the handle is found.
    fireEvent.pointerOver(box)
    expect(tag.style.opacity).toBe('1')
    cleanup()

    // Selected, it stays up with no pointer on it at all: the user has to
    // be able to tell which box is which, and where to grab this one.
    expect(tagOf(renderOverlay(true, { name: 'Date' }).box).style.opacity).toBe('1')
    cleanup()
    // Being named, likewise -- the box itself is the editor just then.
    const naming = { value: 'Da', onChange: vi.fn(), onCommit: vi.fn(), onCancel: vi.fn() }
    const { box: beingNamed } = renderOverlay(false, { slot: { ...makeSlot(), text: '' }, name: 'Date', naming })
    expect(tagOf(beingNamed).style.opacity).toBe('1')
  })

  it('a hidden tag is still the handle: hovering it and dragging moves the slot', () => {
    const onChange = vi.fn()
    const { box } = renderOverlay(false, { name: 'Date', onChange })
    const tag = tagOf(box)
    expect(tag.style.opacity).toBe('0')
    fireEvent.pointerOver(tag)
    fireEvent.pointerDown(tag, { pointerId: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(tag, { pointerId: 1, clientX: 40, clientY: 0 })
    expect(onChange).toHaveBeenLastCalledWith({ x: 50, y: 700 })
    fireEvent.pointerUp(tag, { pointerId: 1 })
  })

  it('the placeholder gives way to text, and a committed slot hides its DOM text but never its placeholder', () => {
    const withText = renderOverlay(false, { name: 'Date', textCommitted: true }).box
    expect(withText.querySelector('[data-slot-line][data-placeholder]')).toBeNull()
    // No line spans at all: the canvas is showing this text.
    expect(withText.querySelectorAll('[data-slot-line]').length).toBe(0)
    cleanup()
    const empty = renderOverlay(false, { slot: { ...makeSlot(), text: '' }, name: 'Date', textCommitted: true }).box
    expect(empty.textContent).toContain('Date')
  })

  it('selected: prints the box size in points under it, counter-scaled', () => {
    const { box } = renderOverlay(true, { slot: { ...makeSlot(), height: 40 }, screenScale: 2 })
    const badge = box.querySelector('[data-testid="slot-size-badge"]') as HTMLElement
    expect(badge.textContent).toBe('200 × 40')
    expect(badge.style.transform).toContain('scale(0.5)')
    cleanup()
    expect(renderOverlay(false).box.querySelector('[data-testid="slot-size-badge"]')).toBeNull()
  })

  it('naming: an inline input in place of the textarea; Enter commits, Escape cancels, typing reports', () => {
    const naming = { value: 'Da', onChange: vi.fn(), onCommit: vi.fn(), onCancel: vi.fn() }
    const { box } = renderOverlay(true, { slot: { ...makeSlot(), text: '' }, naming })
    expect(box.querySelector('textarea')).toBeNull()
    const input = box.querySelector('[data-testid="slot-name-inline"]') as HTMLInputElement
    expect(input.value).toBe('Da')
    expect(input.style.fontFamily).toBe('PdfSlotSans')
    fireEvent.change(input, { target: { value: 'Date' } })
    expect(naming.onChange).toHaveBeenCalledWith('Date')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(naming.onCommit).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(naming.onCancel).toHaveBeenCalledTimes(1)
  })

  it('naming: a pointerdown in the input does not start a drag', () => {
    const onChange = vi.fn()
    const naming = { value: '', onChange: vi.fn(), onCommit: vi.fn(), onCancel: vi.fn() }
    const { box } = renderOverlay(true, { slot: { ...makeSlot(), text: '' }, naming, onChange })
    const input = box.querySelector('[data-testid="slot-name-inline"]') as HTMLInputElement
    fireEvent.pointerDown(input, { pointerId: 3, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(box, { pointerId: 3, clientX: 50, clientY: 0 })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('Alt+drag leaves the box where it is and moves a copy: the clone is asked for once, then patches target it', () => {
    const onChange = vi.fn()
    const onCloneStart = vi.fn(() => 'copy-1')
    const { box } = renderOverlay(true, { onChange, onCloneStart })
    const tag = handleOf(box)
    fireEvent.pointerDown(tag, { pointerId: 1, clientX: 0, clientY: 0, altKey: true })
    fireEvent.pointerMove(tag, { pointerId: 1, clientX: 30, clientY: 0, altKey: true })
    fireEvent.pointerMove(tag, { pointerId: 1, clientX: 40, clientY: 0, altKey: true })
    expect(onCloneStart).toHaveBeenCalledTimes(1)
    // At zoom 1 a 40px drag is 40pt; every patch names the copy, never this slot.
    expect(onChange.mock.calls.every(([, id]) => id === 'copy-1')).toBe(true)
    expect(onChange).toHaveBeenLastCalledWith({ x: 50, y: 700 }, 'copy-1')
    fireEvent.pointerUp(tag, { pointerId: 1 })
  })

  it('a plain drag (no Alt) never asks for a clone and patches this slot', () => {
    const onChange = vi.fn()
    const onCloneStart = vi.fn(() => 'copy-1')
    const { box } = renderOverlay(true, { onChange, onCloneStart })
    const tag = handleOf(box)
    fireEvent.pointerDown(tag, { pointerId: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(tag, { pointerId: 1, clientX: 30, clientY: 0 })
    expect(onCloneStart).not.toHaveBeenCalled()
    expect(onChange).toHaveBeenLastCalledWith({ x: 40, y: 700 })
  })

  it('the text box stays selectable even though the stage around it is not', () => {
    const { textarea } = renderOverlay(true)
    expect(textarea.style.userSelect).toBe('text')
  })
})
