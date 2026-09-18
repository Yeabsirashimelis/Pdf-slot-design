import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotPanel } from '@/features/template/SlotPanel'

const slots = [
  { id: 'a', name: 'CO#', text: '', page: 0, x: 50, y: 700 },
  { id: 'b', name: 'Date', text: '07/11/2024', page: 0, x: 50, y: 650 },
]
const noop = () => {}
const base = {
  slots, selectedId: null, pageIndex: 0, onPageChange: noop,
  onSelect: noop, onRename: noop, onRemove: noop, onDuplicate: noop,
  onNext: noop, onBack: noop, onChangeText: noop, onSave: noop,
}

describe('SlotPanel', () => {
  afterEach(() => cleanup())

  it('step 1: one chip per slot; click selects, ✕ removes, double-click renames; Next', () => {
    const onSelect = vi.fn(), onRemove = vi.fn(), onRename = vi.fn(), onNext = vi.fn()
    render(createElement(SlotPanel, { ...base, step: 'layout', selectedId: 'b', onSelect, onRemove, onRename, onNext }))
    expect(screen.getByTestId('slot-chip-a').textContent).toContain('CO#')
    expect(screen.getByTestId('slot-chip-b').getAttribute('data-selected')).toBe('true')
    fireEvent.click(screen.getByTestId('slot-chip-a'))
    expect(onSelect).toHaveBeenCalledWith('a')
    fireEvent.click(screen.getByTestId('slot-chip-remove-a'))
    expect(onRemove).toHaveBeenCalledWith('a')
    fireEvent.doubleClick(screen.getByTestId('slot-chip-b'))
    expect(onRename).toHaveBeenCalledWith('b')
    fireEvent.click(screen.getByTestId('panel-next'))
    expect(onNext).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('slot-field-a')).toBeNull()
  })

  it('step 1: a chip is a focusable button; Enter and Space select it, and it reports its pressed state', () => {
    const onSelect = vi.fn()
    render(createElement(SlotPanel, { ...base, step: 'layout', selectedId: 'b', onSelect }))
    const chip = screen.getByTestId('slot-chip-a')
    expect(chip.getAttribute('role')).toBe('button')
    expect(chip.tabIndex).toBe(0)
    expect(chip.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByTestId('slot-chip-b').getAttribute('aria-pressed')).toBe('true')
    fireEvent.keyDown(chip, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith('a')
    fireEvent.keyDown(chip, { key: ' ' })
    expect(onSelect).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(chip, { key: 'Tab' })
    expect(onSelect).toHaveBeenCalledTimes(2)
    // Enter on the nested ✕ is the ✕'s own keypress, not a select.
    fireEvent.keyDown(screen.getByTestId('slot-chip-remove-a'), { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledTimes(2)
  })

  it('step 1: Next is disabled with no slots', () => {
    render(createElement(SlotPanel, { ...base, slots: [], step: 'layout' }))
    expect((screen.getByTestId('panel-next') as HTMLButtonElement).disabled).toBe(true)
  })

  it('step 2: one labelled field per slot; typing reports; focus selects; Back and Save', () => {
    const onChangeText = vi.fn(), onSelect = vi.fn(), onBack = vi.fn(), onSave = vi.fn()
    render(createElement(SlotPanel, { ...base, step: 'write', onChangeText, onSelect, onBack, onSave }))
    const field = screen.getByTestId('slot-field-b') as HTMLTextAreaElement
    expect(field.value).toBe('07/11/2024')
    expect(screen.getByText('Date')).toBeTruthy()
    fireEvent.focus(field)
    expect(onSelect).toHaveBeenCalledWith('b')
    fireEvent.change(field, { target: { value: '08/01/2024' } })
    expect(onChangeText).toHaveBeenCalledWith('b', '08/01/2024')
    fireEvent.click(screen.getByTestId('panel-back'))
    fireEvent.click(screen.getByTestId('panel-save'))
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('slot-chip-a')).toBeNull()
  })

  it('step 1: the chip has a duplicate button that reports the slot id without selecting it', () => {
    const onDuplicate = vi.fn(), onSelect = vi.fn()
    render(createElement(SlotPanel, { ...base, step: 'layout', onDuplicate, onSelect }))
    fireEvent.click(screen.getByTestId('slot-chip-duplicate-a'))
    expect(onDuplicate).toHaveBeenCalledWith('a')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('step 2: no duplicate buttons', () => {
    render(createElement(SlotPanel, { ...base, step: 'write' }))
    expect(screen.queryByTestId('slot-chip-duplicate-a')).toBeNull()
  })
})

describe('SlotPanel hints', () => {
  afterEach(() => cleanup())

  it('step 1 shows the keyboard shortcuts', () => {
    render(createElement(SlotPanel, { ...base, step: 'layout' }))
    const hints = screen.getByTestId('shortcut-hints')
    expect(hints.textContent).toMatch(/undo/)
    expect(hints.textContent).toMatch(/redo/)
    expect(hints.textContent).toMatch(/duplicate/)
    expect(hints.textContent).toMatch(/copy/)
    expect(hints.textContent).toMatch(/paste/)
    expect(hints.textContent).toMatch(/Alt.*drag/)
    expect(hints.querySelectorAll('kbd[data-slot="kbd"]').length).toBeGreaterThanOrEqual(10)
  })
})

describe('SlotPanel pages', () => {
  afterEach(() => cleanup())
  const twoPages = [
    { id: 'p0', name: 'Owner', text: '', page: 0, x: 50, y: 700 },
    { id: 'p1-bottom', name: 'Date', text: '', page: 1, x: 50, y: 100 },
    { id: 'p1-top', name: 'Vendor', text: '', page: 1, x: 50, y: 700 },
  ]

  it('groups slots by page in reading order; only the current page is open', () => {
    render(createElement(SlotPanel, { ...base, slots: twoPages, step: 'layout', pageIndex: 1 }))
    expect(screen.getByTestId('page-group-trigger-0').textContent).toMatch(/Page 1/)
    expect(screen.getByTestId('page-group-trigger-1').textContent).toMatch(/Page 2.*2 slots/)
    // Page 1's group (index 0) is closed: its chip is not rendered.
    expect(screen.queryByTestId('slot-chip-p0')).toBeNull()
    // Page 2's group is open, top slot first.
    const chips = Array.from(screen.getByTestId('page-group-1').querySelectorAll('[data-testid^="slot-chip-p1"]:not([data-testid*="-remove-"]):not([data-testid*="-duplicate-"])'))
    expect(chips.map((c) => c.textContent)).toEqual(['Vendor', 'Date'])
  })

  it('the user can open another page\'s group; a page change then resets to just that page', () => {
    const { rerender } = render(createElement(SlotPanel, { ...base, slots: twoPages, step: 'layout', pageIndex: 1 }))
    fireEvent.click(screen.getByTestId('page-group-trigger-0'))
    expect(screen.getByTestId('slot-chip-p0')).toBeTruthy()
    expect(screen.getByTestId('slot-chip-p1-top')).toBeTruthy()
    rerender(createElement(SlotPanel, { ...base, slots: twoPages, step: 'layout', pageIndex: 0 }))
    expect(screen.getByTestId('slot-chip-p0')).toBeTruthy()
    expect(screen.queryByTestId('slot-chip-p1-top')).toBeNull()
  })

  it('clicking a chip on another page jumps to that page; a field focus does too', () => {
    const onPageChange = vi.fn(), onSelect = vi.fn()
    render(createElement(SlotPanel, { ...base, slots: twoPages, step: 'layout', pageIndex: 1, onPageChange, onSelect }))
    fireEvent.click(screen.getByTestId('page-group-trigger-0'))
    fireEvent.click(screen.getByTestId('slot-chip-p0'))
    expect(onSelect).toHaveBeenCalledWith('p0')
    expect(onPageChange).toHaveBeenCalledWith(0)
    cleanup()
    const onPageChange2 = vi.fn()
    render(createElement(SlotPanel, { ...base, slots: twoPages, step: 'write', pageIndex: 0, onPageChange: onPageChange2 }))
    fireEvent.click(screen.getByTestId('page-group-trigger-1'))
    fireEvent.focus(screen.getByTestId('slot-field-p1-top'))
    expect(onPageChange2).toHaveBeenCalledWith(1)
  })

  it('the current page always has a group, even with no slots yet', () => {
    render(createElement(SlotPanel, { ...base, slots: twoPages, step: 'layout', pageIndex: 5 }))
    expect(screen.getByTestId('page-group-trigger-5').textContent).toMatch(/Page 6.*no slots yet/)
  })
})
