import { expect, test } from 'vitest'
import { layoutText } from '../src/layout/wrap.js'
import type { FontMetrics } from '../src/layout/metrics.js'

/** Every glyph is exactly `size` wide. Makes expected breaks arithmetic. */
const fixed: FontMetrics = {
  widthOfText: (t, size) => t.length * size,
  ascender: (size) => size * 0.75,
  descender: (size) => -size * 0.25,
  unsupportedCharacters: () => [],
}

const base = {
  size: 10, align: 'left' as const, lineHeight: 1.2,
  originX: 0, originY: 100,
}

test('text shorter than the box stays on one line', () => {
  const lines = layoutText({ ...base, text: 'abc', width: 100 }, fixed)
  expect(lines.map((l) => l.text)).toEqual(['abc'])
})

test('breaks at the last word that fits', () => {
  // width 50 = 5 chars. 'aaa bbb' → 'aaa' (30) fits, +' bbb' (70) does not.
  const lines = layoutText({ ...base, text: 'aaa bbb', width: 50 }, fixed)
  expect(lines.map((l) => l.text)).toEqual(['aaa', 'bbb'])
})

test('a word longer than the box is hard-broken rather than overflowing', () => {
  const lines = layoutText({ ...base, text: 'aaaaaaaa', width: 30 }, fixed)
  expect(lines.map((l) => l.text)).toEqual(['aaa', 'aaa', 'aa'])
})

test('explicit newlines are honoured', () => {
  const lines = layoutText({ ...base, text: 'a\nb', width: 100 }, fixed)
  expect(lines.map((l) => l.text)).toEqual(['a', 'b'])
})

test('blank lines are preserved', () => {
  const lines = layoutText({ ...base, text: 'a\n\nb', width: 100 }, fixed)
  expect(lines.map((l) => l.text)).toEqual(['a', '', 'b'])
})

test('baselines descend by size * lineHeight', () => {
  const lines = layoutText({ ...base, text: 'a\nb', width: 100 }, fixed)
  expect(lines[0]!.baselineY - lines[1]!.baselineY).toBeCloseTo(12, 6)
})

test('first baseline sits one ascender below the box top', () => {
  const lines = layoutText({ ...base, text: 'a', width: 100 }, fixed)
  expect(lines[0]!.baselineY).toBeCloseTo(100 - 7.5, 6)
})

test('centre alignment offsets by half the slack', () => {
  const lines = layoutText({ ...base, text: 'aa', width: 100, align: 'center' }, fixed)
  expect(lines[0]!.x).toBeCloseTo((100 - 20) / 2, 6)
})

test('right alignment pushes to the far edge', () => {
  const lines = layoutText({ ...base, text: 'aa', width: 100, align: 'right' }, fixed)
  expect(lines[0]!.x).toBeCloseTo(80, 6)
})

test('empty text produces no lines', () => {
  expect(layoutText({ ...base, text: '', width: 100 }, fixed)).toEqual([])
})
