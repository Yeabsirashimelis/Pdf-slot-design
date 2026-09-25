import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NumberField } from '@/features/editor/panels/NumberField'

describe('NumberField', () => {
  afterEach(() => cleanup())

  const field = (extra: Partial<Parameters<typeof NumberField>[0]> = {}) => {
    const onCommit = vi.fn()
    const props: Parameters<typeof NumberField>[0] = {
      'aria-label': 'Padding',
      value: 0,
      min: 0,
      max: 72,
      onCommit,
      ...extra,
    }
    render(createElement(NumberField, props))
    return { onCommit, input: screen.getByLabelText('Padding') as HTMLInputElement }
  }

  it('a held arrow steps on, rather than sticking on the first number', () => {
    // The value comes down as a prop, and a repeating key fires faster
    // than the prop comes back. Stepping from the prop made every repeat
    // compute the same number: the field looked stuck and the same value
    // was committed over and over.
    const { onCommit, input } = field({ value: 0 })
    for (let i = 0; i < 5; i++) fireEvent.keyDown(input, { key: 'ArrowUp' })

    expect(onCommit.mock.calls.map(([n]) => n)).toEqual([1, 2, 3, 4, 5])
    expect(input.value).toBe('5')
  })

  it('steps down the same way, and never past its limits', () => {
    const { onCommit, input } = field({ value: 2 })
    for (let i = 0; i < 5; i++) fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(onCommit.mock.calls.map(([n]) => n)).toEqual([1, 0, 0, 0, 0])
    expect(input.value).toBe('0')
  })

  it('Shift steps by ten', () => {
    const { onCommit } = field({ value: 0 })
    fireEvent.keyDown(screen.getByLabelText('Padding'), { key: 'ArrowUp', shiftKey: true })
    expect(onCommit).toHaveBeenCalledWith(10)
  })

  it('typing a number and pressing Enter commits it', () => {
    const { onCommit, input } = field({ value: 4 })
    fireEvent.change(input, { target: { value: '18' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledWith(18)
  })

  it('Escape drops what was typed', () => {
    const { onCommit, input } = field({ value: 4 })
    fireEvent.change(input, { target: { value: '18' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onCommit).not.toHaveBeenCalled()
    expect(input.value).toBe('4')
  })
})
