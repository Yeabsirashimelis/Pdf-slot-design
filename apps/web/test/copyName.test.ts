import { describe, expect, it } from 'vitest'
import { copyName } from '@/features/template/copyName'

/**
 * Duplicating "six" repeatedly must read six copy, six copy (2), six copy
 * (3) -- never "six copy copy copy". Duplicating a copy counts from the
 * same base, and a freed-up number is reused.
 */
describe('copyName', () => {
  it('first copy gets " copy", later ones a number', () => {
    expect(copyName('six', ['six'])).toBe('six copy')
    expect(copyName('six', ['six', 'six copy'])).toBe('six copy (2)')
    expect(copyName('six', ['six', 'six copy', 'six copy (2)'])).toBe('six copy (3)')
  })

  it('duplicating a copy derives from the base name, not the copy', () => {
    expect(copyName('six copy', ['six', 'six copy'])).toBe('six copy (2)')
    expect(copyName('six copy (2)', ['six', 'six copy', 'six copy (2)'])).toBe('six copy (3)')
  })

  it('reuses a number that is no longer taken', () => {
    expect(copyName('six', ['six', 'six copy (3)'])).toBe('six copy')
    expect(copyName('six copy (3)', ['six copy', 'six copy (3)'])).toBe('six copy (2)')
  })

  it('leaves names that merely contain "copy" alone', () => {
    expect(copyName('photocopy', ['photocopy'])).toBe('photocopy copy')
    expect(copyName('copy', ['copy'])).toBe('copy copy')
  })
})
