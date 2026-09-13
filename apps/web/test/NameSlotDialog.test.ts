import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NameSlotDialog } from '@/features/template/NameSlotDialog'

describe('NameSlotDialog', () => {
  afterEach(() => cleanup())

  it('submits the trimmed name on Enter and via the Add button; refuses empty', () => {
    const onSubmit = vi.fn()
    render(createElement(NameSlotDialog, { open: true, onSubmit, onCancel: vi.fn() }))
    const input = screen.getByTestId('slot-name-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.click(screen.getByTestId('slot-name-submit'))
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '  CO#  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith('CO#')
  })

  it('cancels via the Cancel button', () => {
    const onCancel = vi.fn()
    render(createElement(NameSlotDialog, { open: true, onSubmit: vi.fn(), onCancel }))
    fireEvent.click(screen.getByTestId('slot-name-cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('starts from initialName when renaming', () => {
    render(createElement(NameSlotDialog, { open: true, initialName: 'Date', onSubmit: vi.fn(), onCancel: vi.fn() }))
    expect((screen.getByTestId('slot-name-input') as HTMLInputElement).value).toBe('Date')
  })
})
