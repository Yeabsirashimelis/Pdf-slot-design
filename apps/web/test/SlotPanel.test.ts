import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotPanel } from '@/features/template/SlotPanel'

const slots = [
  { id: 'a', name: 'CO#', text: '' },
  { id: 'b', name: 'Date', text: '07/11/2024' },
]
const noop = () => {}
const base = {
  slots, selectedId: null, onSelect: noop, onRename: noop, onRemove: noop, onDuplicate: noop,
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
    expect(hints.querySelectorAll('kbd[data-slot="kbd"]').length).toBeGreaterThanOrEqual(5)
  })
})
