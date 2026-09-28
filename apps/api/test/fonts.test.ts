import { FONT_IDS } from '@pdf-slot/core'
import { describe, expect, it } from 'vitest'
import { embeddedFontProvider } from '../src/jobs/fonts.js'
import { coreFonts } from './helpers/fixtures.js'

describe('embeddedFontProvider', () => {
  it('hands steps the same bytes the editor ships, without touching disk or asset storage', async () => {
    const fonts = await embeddedFontProvider()()
    const shipped = coreFonts()
    expect(Object.keys(fonts).sort()).toEqual([...FONT_IDS].sort())
    for (const id of FONT_IDS) {
      expect(fonts[id].byteLength, id).toBe(shipped[id].byteLength)
      expect(Buffer.compare(Buffer.from(fonts[id]), Buffer.from(shipped[id])), id).toBe(0)
    }
  })

  it('resolves to one FontBytes instance for the life of the provider, which steps.ts keys its metrics cache on', async () => {
    const fonts = embeddedFontProvider()
    const [a, b] = await Promise.all([fonts(), fonts()])
    // Written as identity checks: vitest's toBe on unequal objects deep-compares to word its message.
    expect(a === b).toBe(true)
    expect((await fonts()) === a).toBe(true)
  })
})
