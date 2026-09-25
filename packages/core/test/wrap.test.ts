import { expect, test } from 'vitest'
import { MIN_TEXT_WIDTH, layoutHeight, layoutText, slotInset, slotLayout } from '../src/layout/wrap.js'
import type { Slot } from '../src/document/types.js'
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

test('layoutHeight is the line boxes when the leading is generous: n x size x lineHeight', () => {
  // 3 lines of 10pt at 1.2: 36pt of line boxes, more than the 10 + 2 x 12
  // = 34pt from the first ascender to the last descender.
  expect(layoutHeight(3, 10, 1.2, fixed)).toBeCloseTo(36, 6)
})

test('layoutHeight never cuts the glyphs off when the line height is tight', () => {
  // At 0.5 the line boxes are 15pt for 3 lines, but the glyphs run from
  // the first ascender (7.5 below the top) through two 5pt steps to the
  // last descender (2.5 more): 7.5 + 10 + 2.5 = 20pt. The box takes that.
  expect(layoutHeight(3, 10, 0.5, fixed)).toBeCloseTo(20, 6)
  // One line is never shorter than its own glyphs, whatever the line height.
  expect(layoutHeight(1, 10, 0.5, fixed)).toBeCloseTo(10, 6)
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

/** A box with text in it, for the padding tests. */
const padded: Slot = {
  id: 's1', page: 0, x: 100, y: 700, width: 200, text: 'hello',
  fontId: 'sans', size: 10, color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2,
}

test('no padding: the text starts at the box\'s own corner', () => {
  const input = slotLayout(padded, padded.text)
  expect([input.originX, input.originY, input.width]).toEqual([100, 700, 200])
})

test('padding insets every side, and does not move the box', () => {
  const input = slotLayout({ ...padded, padding: 4 }, padded.text)
  expect(input.originX).toBe(104)
  // PDF y grows upward, so coming in from the top means going down.
  expect(input.originY).toBe(696)
  expect(input.width).toBe(192)
})

test('padding never squeezes a line down to single letters', () => {
  const narrow = { ...padded, width: 40, padding: 50 }
  expect(slotLayout(narrow, narrow.text).width).toBe(MIN_TEXT_WIDTH)
  expect(slotInset(narrow)).toBe((40 - MIN_TEXT_WIDTH) / 2)
})

test('a box with a height of its own keeps room for a line inside the padding', () => {
  // A table's cell owns its row: if padding pushed the text past the
  // row's height the box would grow and the table would come apart.
  // `fixed` makes a line exactly `size` tall (0.75 up, 0.25 down).
  const cell = { ...padded, width: 200, height: 22, padding: 50 }
  expect(slotInset(cell, fixed)).toBe((22 - 10) / 2)
  // Without a height there is nothing below to protect: the padding is
  // taken as asked, since 50 a side still leaves a line's worth across.
  const free = { ...padded, width: 200, height: undefined, padding: 50 }
  expect(slotInset(free, fixed)).toBe(50)
  // Only a box too narrow for it pulls the number down.
  expect(slotInset({ ...free, width: 80 }, fixed)).toBe((80 - MIN_TEXT_WIDTH) / 2)
})

test('the text still fits the row it was given', () => {
  const cell = { ...padded, width: 200, height: 22, size: 10, padding: 50 }
  const inset = slotInset(cell, fixed)
  const line = fixed.ascender(10) - fixed.descender(10)
  expect(line + inset * 2).toBeLessThanOrEqual(22)
})

test('a negative padding is no padding', () => {
  expect(slotInset({ ...padded, padding: -8 })).toBe(0)
})

test('right-aligned text is held off the right edge by the padding', () => {
  const lines = layoutText(slotLayout({ ...padded, align: 'right', padding: 6 }, 'hi'), fixed)
  // Every glyph is `size` wide here, so 'hi' is 20pt. The box ends at
  // 300; the text ends 6pt short of it.
  expect(lines[0]!.x + 20).toBeCloseTo(294)
})

test('padding pushes the first baseline down, not the box', () => {
  const plain = layoutText(slotLayout(padded, 'hi'), fixed)
  const inset = layoutText(slotLayout({ ...padded, padding: 5 }, 'hi'), fixed)
  expect(plain[0]!.baselineY - inset[0]!.baselineY).toBeCloseTo(5)
})
