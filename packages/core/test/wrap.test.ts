import { expect, test } from 'vitest'
import { layoutHeight, layoutText } from '../src/layout/wrap.js'
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

test('layoutHeight scales linearly with line count', () => {
  expect(layoutHeight(3, 10, 1.2)).toBeCloseTo(36, 6)
})

test('CRLF line endings do not leave a trailing carriage return', () => {
  const lines = layoutText({ ...base, text: 'a\r\nb', width: 100 }, fixed)
  expect(lines.map((l) => l.text)).toEqual(['a', 'b'])
})

test('a lone CR (classic Mac line ending) is also normalized', () => {
  const lines = layoutText({ ...base, text: 'a\rb', width: 100 }, fixed)
  expect(lines.map((l) => l.text)).toEqual(['a', 'b'])
})

test('a hard character break never splits a grapheme cluster', () => {
  // Built from NFD components (base letter + combining acute), not the
  // precomposed 'é' literal -- otherwise this wouldn't exercise the bug.
  const e = 'e' + '\u0301'
  const word = e.repeat(4) // 4 grapheme clusters, 8 UTF-16 code units
  // width 30 = 3 fixed-width units. Each cluster is 2 units wide, so a
  // code-point-at-a-time break (the bug) lands on an odd unit offset and
  // splits a cluster; a cluster-at-a-time break only ever lands on even
  // offsets, so exactly one cluster fits per line.
  const lines = layoutText({ ...base, text: word, width: 30 }, fixed)
  expect(lines.map((l) => l.text)).toEqual([e, e, e, e])
  // No line may start with an isolated combining mark.
  for (const line of lines) {
    expect(line.text.codePointAt(0)).not.toBe(0x0301)
  }
})
