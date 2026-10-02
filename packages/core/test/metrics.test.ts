import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { createFontMetrics } from '../src/layout/metrics.js'

const dir = fileURLToPath(new URL('../src/fonts/files/', import.meta.url))
const sans = createFontMetrics(readFileSync(dir + 'Inter-Regular.ttf'))

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

/**
 * widthOfText memoises the advance-width sum per string (metrics.ts). These
 * pin the two ways that could go wrong and would otherwise go unnoticed,
 * because a wrong width does not throw -- it just wraps the exported line
 * somewhere the preview did not.
 */
describe('the width memo is invisible', () => {
  test('a cached string still scales with size, so the size is never cached with it', () => {
    const fresh = createFontMetrics(readFileSync(dir + 'Inter-Regular.ttf'))
    // First call misses and fills the cache at size 10; the rest hit it.
    const at10 = fresh.widthOfText('Acme Construction', 10)
    expect(fresh.widthOfText('Acme Construction', 20)).toBeCloseTo(at10 * 2, 9)
    expect(fresh.widthOfText('Acme Construction', 10)).toBe(at10)
  })

  test('a string measures the same after the cache has been dropped as before', () => {
    const fresh = createFontMetrics(readFileSync(dir + 'Inter-Regular.ttf'))
    const before = fresh.widthOfText('Acme Construction Company Ltd', 14)
    // Overflow the bound (4096) so the map is cleared and the next call for
    // the same string has to measure it again from the font.
    for (let i = 0; i < 4200; i++) fresh.widthOfText(`filler ${i}`, 14)
    expect(fresh.widthOfText('Acme Construction Company Ltd', 14)).toBe(before)
  })

  test('shaped text is measured as shaped whether it is cached or not', () => {
    // Inter's `calt` turns `->` into one arrow glyph, so the string really
    // is narrower than its characters measured one at a time. A memo that
    // cached an unshaped sum, or shaping that stopped being applied, shows
    // up here and nowhere else in this file.
    const fresh = createFontMetrics(readFileSync(dir + 'Inter-Regular.ttf'))
    const shaped = fresh.widthOfText('a->b', 100)
    const perCharacter = [...'a->b'].reduce((total, c) => total + fresh.widthOfText(c, 100), 0)
    expect(shaped).toBeLessThan(perCharacter)
    // And the same answer on the way back out of the cache.
    expect(fresh.widthOfText('a->b', 100)).toBe(shaped)
  })
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
