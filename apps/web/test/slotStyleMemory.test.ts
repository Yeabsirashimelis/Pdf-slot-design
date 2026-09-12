import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Slot } from '@pdf-slot/core'
import { recallSlotStyle, rememberSlotStyle, SLOT_STYLE_KEY } from '@/features/editor/state/slotStyleMemory'

/**
 * A new text box starts with the font, size, colour and alignment the
 * user last chose, not the factory defaults -- someone filling a form
 * in 10pt red serif should not have to re-pick that for every field.
 * Persisted in localStorage so it survives a reload and a "Start over".
 */
describe('slotStyleMemory', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('returns nothing until a style has been remembered', () => {
    expect(recallSlotStyle()).toEqual({})
  })

  it('round-trips the four style fields and nothing else', () => {
    // A whole Slot is accepted (that is what the store hands over); only
    // the style fields are kept.
    const slot: Slot = {
      id: 'x', page: 0, x: 1, y: 2, width: 200, text: 'hi', lineHeight: 1.2,
      fontId: 'serif', size: 10, color: { r: 0.85, g: 0.15, b: 0.15 }, align: 'right',
    }
    rememberSlotStyle(slot)
    expect(recallSlotStyle()).toEqual({
      fontId: 'serif', size: 10, color: { r: 0.85, g: 0.15, b: 0.15 }, align: 'right',
    })
  })

  it('ignores a stored value that is malformed or out of range', () => {
    localStorage.setItem(SLOT_STYLE_KEY, JSON.stringify({ fontId: 'comic', size: -3, color: { r: 9 }, align: 'up' }))
    expect(recallSlotStyle()).toEqual({})
    localStorage.setItem(SLOT_STYLE_KEY, 'not json')
    expect(recallSlotStyle()).toEqual({})
  })

  it('keeps the valid fields of a partially valid value', () => {
    localStorage.setItem(SLOT_STYLE_KEY, JSON.stringify({ fontId: 'mono', size: 'big' }))
    expect(recallSlotStyle()).toEqual({ fontId: 'mono' })
  })

  it('never throws when storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
    })
    expect(() =>
      rememberSlotStyle({ fontId: 'sans', size: 14, color: { r: 0, g: 0, b: 0 }, align: 'left' }),
    ).not.toThrow()
    expect(recallSlotStyle()).toEqual({})
  })
})
