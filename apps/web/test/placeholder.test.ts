import { describe, expect, it } from 'vitest'
import { placeholderText } from '@/features/editor/overlay/placeholder'

describe('placeholderText', () => {
  it('names the slot: "Your <name> here…"', () => {
    expect(placeholderText('Date')).toBe('Your Date here…')
    expect(placeholderText('  Customer name ')).toBe('Your Customer name here…')
  })

  it('falls back to "text" for a blank name', () => {
    expect(placeholderText('   ')).toBe('Your text here…')
  })
})
