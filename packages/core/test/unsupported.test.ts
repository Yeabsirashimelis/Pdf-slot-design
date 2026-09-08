import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { FONT_FILES, type FontId } from '../src/fonts/registry.js'
import { createFontMetrics, type FontMetrics } from '../src/layout/metrics.js'
import {
  collectUnsupportedCharacters,
  describeUnsupportedCharacters,
  findUnsupportedSlots,
} from '../src/layout/unsupported.js'
import type { Slot } from '../src/document/types.js'

const dir = fileURLToPath(new URL('../src/fonts/files/', import.meta.url))
const cache = new Map<FontId, FontMetrics>()
const metrics = (id: FontId): FontMetrics => {
  let m = cache.get(id)
  if (!m) {
    m = createFontMetrics(readFileSync(dir + FONT_FILES[id]))
    cache.set(id, m)
  }
  return m
}

const slot = (over: Partial<Slot> = {}): Slot => ({
  id: 's1', page: 0, x: 50, y: 700, width: 300,
  text: 'Hello world', fontId: 'sans', size: 14,
  color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2,
  ...over,
})

test('clean Latin text reports nothing', () => {
  expect(findUnsupportedSlots([slot()], metrics)).toEqual([])
})

test('Cyrillic is supported by PT Sans and reports nothing', () => {
  expect(findUnsupportedSlots([slot({ text: 'Привет мир' })], metrics)).toEqual([])
})

test('CJK is reported, naming the offending characters', () => {
  expect(findUnsupportedSlots([slot({ text: 'Hello 日本語' })], metrics)).toEqual([
    { slotId: 's1', characters: ['日', '本', '語'] },
  ])
})

test('a pasted tab is caught', () => {
  // Reachable in one paste from a spreadsheet, and the cheapest thing in
  // the world to miss: the textarea renders a tab stop, the PDF a .notdef
  // box. Its glyph id really is 0 in every bundled face.
  expect(findUnsupportedSlots([slot({ text: 'Name\tValue' })], metrics)).toEqual([
    { slotId: 's1', characters: ['\t'] },
  ])
})

test('newlines are NOT reported, though their glyph id is also 0', () => {
  // layoutText normalizes and splits on \r\n / \r / \n, so they never reach
  // drawText. Reporting them would block export on every multi-line slot.
  expect(findUnsupportedSlots([slot({ text: 'one\ntwo\r\nthree\rfour' })], metrics)).toEqual([])
})

test('the answer depends on the slot\'s own face, not the text alone', () => {
  // Ω (U+03A9) is in PT Sans's character set but not IBM Plex Mono's, so
  // the same string is safe in one face and not the other. This is why the
  // check is per slot with that slot's own fontId, never per string.
  expect(findUnsupportedSlots([slot({ text: 'Ω' })], metrics)).toEqual([])
  expect(findUnsupportedSlots([slot({ text: 'Ω', fontId: 'mono' })], metrics)).toEqual([
    { slotId: 's1', characters: ['Ω'] },
  ])
})

test('an empty slot reports nothing', () => {
  expect(findUnsupportedSlots([slot({ text: '' })], metrics)).toEqual([])
})

test('collectUnsupportedCharacters dedupes across slots, first-seen order', () => {
  const findings = findUnsupportedSlots(
    [slot({ id: 'a', text: '日本' }), slot({ id: 'b', text: '本語' })],
    metrics,
  )
  expect(collectUnsupportedCharacters(findings)).toEqual(['日', '本', '語'])
})

test('describeUnsupportedCharacters names invisible characters', () => {
  expect(describeUnsupportedCharacters(['日', '\t'])).toBe('“日”, tab')
})
