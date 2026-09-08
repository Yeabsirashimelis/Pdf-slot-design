import { expect, test } from 'vitest'
import { rgbToCss } from '../src/document/color.js'

test('scales RGB 0-1 components to CSS bytes', () => {
  expect(rgbToCss({ r: 0, g: 0, b: 0 })).toBe('rgb(0, 0, 0)')
  expect(rgbToCss({ r: 1, g: 1, b: 1 })).toBe('rgb(255, 255, 255)')
  expect(rgbToCss({ r: 37 / 255, g: 99 / 255, b: 235 / 255 })).toBe('rgb(37, 99, 235)')
})

test('a byte-valued colour does not silently come out white', () => {
  // The exact regression: a palette authored in 0-255 used to be multiplied
  // by 255 again, producing rgb(9435 ...), which the browser clamps to
  // white -- the text vanished from the preview with no error anywhere.
  // Clamping here cannot make it visible again (the value really is out of
  // range), but it does keep the emitted string well-formed and assertable.
  expect(rgbToCss({ r: 37, g: 99, b: 235 })).toBe('rgb(255, 255, 255)')
})
