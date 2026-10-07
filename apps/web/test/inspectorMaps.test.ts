import { describe, expect, it } from 'vitest'
import { hasBold, toFontChoice, toFontId } from '@/features/editor/panels/fontChoice'
import { hexToRgb, rgbToHex } from '@/features/editor/panels/colorHex'

describe('font family/weight <-> FontId', () => {
  it('splits every bundled face into a family and a weight', () => {
    expect(toFontChoice('sans')).toEqual({ family: 'sans', weight: 'regular' })
    expect(toFontChoice('sans-bold')).toEqual({ family: 'sans', weight: 'bold' })
    expect(toFontChoice('serif-bold')).toEqual({ family: 'serif', weight: 'bold' })
    expect(toFontChoice('mono')).toEqual({ family: 'mono', weight: 'regular' })
  })

  it('round-trips, and falls back to regular where a family has no bold', () => {
    expect(toFontId('sans', 'bold')).toBe('sans-bold')
    expect(toFontId('serif', 'regular')).toBe('serif')
    expect(toFontId('mono', 'bold')).toBe('mono')
    expect(hasBold('mono')).toBe(false)
    expect(hasBold('sans')).toBe(true)
  })
})

describe('hex <-> RGB', () => {
  it('prints 0-1 components as six lowercase hex digits', () => {
    expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe('000000')
    expect(rgbToHex({ r: 1, g: 1, b: 1 })).toBe('ffffff')
    expect(rgbToHex({ r: 220 / 255, g: 38 / 255, b: 38 / 255 })).toBe('dc2626')
  })

  it('parses with or without #, short or long, any case; rejects junk', () => {
    expect(hexToRgb('#DC2626')).toEqual({ r: 220 / 255, g: 38 / 255, b: 38 / 255 })
    expect(hexToRgb('fff')).toEqual({ r: 1, g: 1, b: 1 })
    expect(hexToRgb('12345')).toBeNull()
    expect(hexToRgb('zzzzzz')).toBeNull()
  })

  it('round-trips a swatch exactly', () => {
    const swatch = { r: 37 / 255, g: 99 / 255, b: 235 / 255 }
    expect(hexToRgb(rgbToHex(swatch))).toEqual(swatch)
  })
})
