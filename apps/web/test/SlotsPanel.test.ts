import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotsPanel, type PanelSlot } from '@/features/editor/panels/SlotsPanel'

const slots: PanelSlot[] = [
  { id: 'a', name: 'Date', text: '', page: 0, x: 10, y: 700 },
  { id: 'b', name: 'Amount', text: '42', page: 0, x: 10, y: 650 },
]

function renderPanel(extra: Partial<Parameters<typeof SlotsPanel>[0]> = {}) {
  const props = {
    fileName: 'form.pdf',
    slots,
    selectedId: null,
    pageIndex: 0,
    pageCount: 1,
    locked: false,
    onLockedChange: vi.fn(),
    onPageChange: vi.fn(),
    onSelect: vi.fn(),
    onRename: vi.fn(),
    onRemove: vi.fn(),
    onDuplicate: vi.fn(),
    onChangeText: vi.fn(),
    onStartOver: vi.fn(),
    ...extra,
  }
  render(createElement(SlotsPanel, props))
  return props
}

describe('SlotsPanel', () => {
  afterEach(() => cleanup())

  it('one row per slot in reading order, each with its name and a value field; click selects, trash removes, copy duplicates', () => {
    const p = renderPanel()
    expect(screen.getByTestId('file-name').textContent).toBe('form.pdf')
    const names = Array.from(document.querySelectorAll('[data-testid^="slot-name-"]')).map((el) => el.textContent)
    expect(names).toEqual(['Date', 'Amount'])
    expect((screen.getByTestId('slot-field-b') as HTMLTextAreaElement).value).toBe('42')

    fireEvent.click(screen.getByTestId('slot-row-a'))
    expect(p.onSelect).toHaveBeenCalledWith('a')
    fireEvent.click(screen.getByTestId('slot-remove-b'))
    expect(p.onRemove).toHaveBeenCalledWith('b')
    fireEvent.click(screen.getByTestId('slot-duplicate-a'))
    expect(p.onDuplicate).toHaveBeenCalledWith('a')
    // The buttons act without also selecting the row.
    expect(p.onSelect).toHaveBeenCalledTimes(1)
  })

  it('typing in a field reports the slot and text; focusing it selects the slot', () => {
    const p = renderPanel()
    const field = screen.getByTestId('slot-field-a') as HTMLTextAreaElement
    fireEvent.focus(field)
    expect(p.onSelect).toHaveBeenCalledWith('a')
    fireEvent.change(field, { target: { value: 'today' } })
    expect(p.onChangeText).toHaveBeenCalledWith('a', 'today')
  })

  it('a row is a focusable button: Enter and Space select it, and it reports its pressed state', () => {
    const p = renderPanel({ selectedId: 'b' })
    const row = screen.getByTestId('slot-row-a')
    expect(row.getAttribute('tabindex')).toBe('0')
    expect(screen.getByTestId('slot-row-b').getAttribute('aria-pressed')).toBe('true')
    fireEvent.keyDown(row, { key: 'Enter' })
    fireEvent.keyDown(row, { key: ' ' })
    expect(p.onSelect).toHaveBeenCalledTimes(2)
  })

  it('double-clicking a name edits it in place: Enter keeps, Escape reverts, empty reverts', () => {
    const p = renderPanel()
    fireEvent.doubleClick(screen.getByTestId('slot-name-a'))
    let input = screen.getByTestId('slot-rename-input') as HTMLInputElement
    expect(input.value).toBe('Date')
    fireEvent.change(input, { target: { value: 'Due date' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(p.onRename).toHaveBeenCalledWith('a', 'Due date')

    fireEvent.doubleClick(screen.getByTestId('slot-name-b'))
    input = screen.getByTestId('slot-rename-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Total' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(p.onRename).toHaveBeenCalledTimes(1)

    fireEvent.doubleClick(screen.getByTestId('slot-name-b'))
    input = screen.getByTestId('slot-rename-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '  ' } })
    fireEvent.blur(input)
    expect(p.onRename).toHaveBeenCalledTimes(1)
  })

  it('the padlock reports its state and disables the row buttons', () => {
    const p = renderPanel({ locked: true })
    expect(screen.getByTestId('lock-toggle').getAttribute('aria-pressed')).toBe('true')
    expect((screen.getByTestId('slot-remove-a') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('slot-duplicate-a') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByTestId('lock-toggle'))
    expect(p.onLockedChange).toHaveBeenCalledWith(false)
  })

  it('groups by page only for a multi-page document; a row on another page jumps there', () => {
    const p = renderPanel({
      pageCount: 3,
      slots: [...slots, { id: 'c', name: 'Signature', text: '', page: 2, x: 10, y: 100 }],
    })
    expect(screen.getByTestId('page-group-trigger-0').textContent).toBe('Page 1')
    expect(screen.getByTestId('page-group-trigger-2').textContent).toBe('Page 3')
    fireEvent.click(screen.getByTestId('slot-row-c'))
    expect(p.onSelect).toHaveBeenCalledWith('c')
    expect(p.onPageChange).toHaveBeenCalledWith(2)
    fireEvent.click(screen.getByTestId('page-group-trigger-2'))
    expect(p.onPageChange).toHaveBeenCalledTimes(2)
  })

  it('the footer lists the shortcuts, copy/paste and Alt+drag included', () => {
    renderPanel()
    const hints = screen.getByTestId('shortcut-hints')
    expect(hints.textContent).toMatch(/copy \/ paste/)
    expect(hints.textContent).toMatch(/Alt.*drag/)
    expect(hints.querySelectorAll('kbd[data-slot="kbd"]').length).toBeGreaterThanOrEqual(10)
  })

  it('with no slots, says how to add one; the back arrow leaves the file', () => {
    const p = renderPanel({ slots: [] })
    expect(screen.getByTestId('empty-hint').textContent).toMatch(/click anywhere on the page/i)
    expect(screen.queryByTestId('page-group-trigger-0')).toBeNull()
    fireEvent.click(screen.getByTestId('start-over-button'))
    expect(p.onStartOver).toHaveBeenCalledTimes(1)
  })
})
