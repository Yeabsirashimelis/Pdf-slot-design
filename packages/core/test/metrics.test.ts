import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { createFontMetrics } from '../src/layout/metrics.js'

const dir = fileURLToPath(new URL('../src/fonts/files/', import.meta.url))
const sans = createFontMetrics(readFileSync(dir + 'PT_Sans-Web-Regular.ttf'))

test('width scales linearly with size', () => {
  const at10 = sans.widthOfText('Hamburgefonstiv', 10)
  const at20 = sans.widthOfText('Hamburgefonstiv', 20)
  expect(at20).toBeCloseTo(at10 * 2, 6)
})

test('empty string has zero width', () => {
  expect(sans.widthOfText('', 12)).toBe(0)
})

test('wider text measures wider', () => {
  expect(sans.widthOfText('mmmm', 12)).toBeGreaterThan(sans.widthOfText('iiii', 12))
})

test('ascender is positive and descender negative', () => {
  expect(sans.ascender(100)).toBeGreaterThan(0)
  expect(sans.descender(100)).toBeLessThan(0)
})

test('monospace advances are uniform', () => {
  const mono = createFontMetrics(readFileSync(dir + 'IBMPlexMono-Regular.ttf'))
  expect(mono.widthOfText('iiii', 12)).toBeCloseTo(mono.widthOfText('mmmm', 12), 6)
})

test('unsupportedCharacters returns empty array for a Latin string', () => {
  expect(sans.unsupportedCharacters('Hamburgefonstiv')).toEqual([])
})

test('unsupportedCharacters returns CJK characters this face cannot encode', () => {
  expect(sans.unsupportedCharacters('日本語')).toEqual(['日', '本', '語'])
})

test('unsupportedCharacters dedupes, preserving first-seen order', () => {
  expect(sans.unsupportedCharacters('日本日語本')).toEqual(['日', '本', '語'])
})
