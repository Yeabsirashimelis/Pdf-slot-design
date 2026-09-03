import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { FONT_FILES, FONT_IDS } from '../src/fonts/registry.js'

const dir = fileURLToPath(new URL('../src/fonts/files/', import.meta.url))

test.each(FONT_IDS)('%s is a valid static TTF', (id) => {
  const bytes = readFileSync(dir + FONT_FILES[id])
  expect(bytes.byteLength).toBeGreaterThan(20_000)
  // TrueType outlines start with 0x00010000; OpenType/CFF starts with 'OTTO' (0x4F54544F).
  const magic = bytes.readUInt32BE(0)
  expect([0x00010000, 0x4f54544f]).toContain(magic)
  // A variable font carries an 'fvar' table. We must not ship one.
  expect(bytes.includes(Buffer.from('fvar'))).toBe(false)
})
