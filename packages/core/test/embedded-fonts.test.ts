import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { EMBEDDED_FONTS, EMBEDDED_FONT_IDS, decodeEmbeddedFonts } from '../src/fonts/embedded.js'
import { FONT_FILES, FONT_IDS } from '../src/fonts/registry.js'

const dir = fileURLToPath(new URL('../src/fonts/files/', import.meta.url))

/**
 * The embedded module is what the API renders with in production, where the
 * TTFs on disk are not there to fall back on. The editor draws its preview
 * with those same TTFs (the web app serves them from /fonts), so the two
 * must never diverge: a byte-for-byte comparison against the files is the
 * guard, and it is what fails if a TTF changes without `npm run fonts:embed`.
 */
describe('embedded fonts', () => {
  test('inlines the registry\'s ids, so the module imports nothing at runtime', () => {
    // The API's Workflow steps load this file directly, with no bundler: a value
    // import of the registry would fail to resolve there (it is a .ts file).
    expect([...EMBEDDED_FONT_IDS]).toEqual([...FONT_IDS])
    const source = readFileSync(fileURLToPath(new URL('../src/fonts/embedded.ts', import.meta.url)), 'utf8').slice(0, 2000)
    expect(source).toContain("import type {")
    expect(source).not.toMatch(/^import \{/m)
  })

  test('carries exactly the registry\'s font ids', () => {
    expect(Object.keys(EMBEDDED_FONTS).sort()).toEqual([...FONT_IDS].sort())
  })

  test.each(FONT_IDS)('%s decodes to the bytes of its TTF on disk', (id) => {
    const decoded = decodeEmbeddedFonts()[id]
    const onDisk = readFileSync(dir + FONT_FILES[id])
    const stale = `${id} differs from ${FONT_FILES[id]}: regenerate with \`npm run fonts:embed\``
    expect(decoded).toBeInstanceOf(Uint8Array)
    expect(decoded.byteLength, stale).toBe(onDisk.byteLength)
    expect(Buffer.compare(Buffer.from(decoded), onDisk), stale).toBe(0)
  })

  test('every call decodes afresh, so one caller\'s copy is never another\'s', () => {
    const a = decodeEmbeddedFonts()
    const b = decodeEmbeddedFonts()
    // Identity checks written out: vitest's `not.toBe` on unequal objects falls back to a deep
    // comparison to word its message, which takes seconds over five ~450 KB arrays.
    expect(a === b).toBe(false)
    expect(a.sans === b.sans).toBe(false)
    expect(a.sans.buffer === b.sans.buffer).toBe(false)
  })
})
