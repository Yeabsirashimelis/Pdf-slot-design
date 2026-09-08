import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FONT_CSS_FAMILY, FONT_FILES, FONT_IDS } from '@pdf-slot/core'

/**
 * jsdom does not implement the CSS Font Loading API (`FontFace`,
 * `document.fonts`), so registerFontFaces() is exercised against a minimal
 * stand-in rather than the real browser API.
 */
class FakeFontFace {
  family: string
  source: unknown
  constructor(family: string, source: unknown) {
    this.family = family
    this.source = source
  }
  async load() {
    return this
  }
}

function makeResponse(ok: boolean, bytes: Uint8Array = new Uint8Array([1, 2, 3, 4])): Response {
  return {
    ok,
    arrayBuffer: async () => bytes.buffer,
  } as unknown as Response
}

describe('loadFonts', () => {
  let fontsAdd: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // The module memoises `cache` at module scope; reset the module
    // registry so each test starts with a clean, un-memoised loader.
    vi.resetModules()
    fontsAdd = vi.fn()
    vi.stubGlobal('FontFace', FakeFontFace)
    vi.stubGlobal('document', { fonts: { add: fontsAdd } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('fetches all five ids and returns non-empty bytes for each', async () => {
    const fetchMock = vi.fn(async () => makeResponse(true))
    vi.stubGlobal('fetch', fetchMock)

    const { loadFontBytes } = await import('../src/lib/fonts/loadFonts')
    const bytes = await loadFontBytes()

    expect(fetchMock).toHaveBeenCalledTimes(FONT_IDS.length)
    for (const id of FONT_IDS) {
      expect(fetchMock).toHaveBeenCalledWith(`/fonts/${FONT_FILES[id]}`)
      expect(bytes[id]).toBeInstanceOf(Uint8Array)
      expect(bytes[id].byteLength).toBeGreaterThan(0)
    }
  })

  it('registerFontFaces adds one face per id, named per FONT_CSS_FAMILY', async () => {
    const fetchMock = vi.fn(async () => makeResponse(true))
    vi.stubGlobal('fetch', fetchMock)

    const { loadFontBytes, registerFontFaces } = await import('../src/lib/fonts/loadFonts')
    const bytes = await loadFontBytes()
    await registerFontFaces(bytes)

    expect(fontsAdd).toHaveBeenCalledTimes(FONT_IDS.length)
    const registeredFamilies = fontsAdd.mock.calls.map(([face]) => (face as FakeFontFace).family)
    for (const id of FONT_IDS) {
      expect(registeredFamilies).toContain(FONT_CSS_FAMILY[id])
    }
  })

  it('a failed fetch surfaces a useful error naming which font failed', async () => {
    const fetchMock = vi.fn(async (url: string) => makeResponse(!url.endsWith(FONT_FILES.mono)))
    vi.stubGlobal('fetch', fetchMock)

    const { loadFontBytes } = await import('../src/lib/fonts/loadFonts')
    await expect(loadFontBytes()).rejects.toThrow('Failed to load font mono')
  })

  it('retries after a transient failure instead of caching the rejection', async () => {
    // `batch` is flipped by the test between calls, not by the mock itself,
    // so the outcome does not depend on the scheduling order of the five
    // concurrent fetches within a single loadFontBytes() call.
    let batch: 'fail' | 'succeed' = 'fail'
    const fetchMock = vi.fn(async () => makeResponse(batch === 'succeed'))
    vi.stubGlobal('fetch', fetchMock)

    const { loadFontBytes } = await import('../src/lib/fonts/loadFonts')

    await expect(loadFontBytes()).rejects.toThrow('Failed to load font')

    batch = 'succeed'
    const bytes = await loadFontBytes()

    expect(fetchMock).toHaveBeenCalledTimes(FONT_IDS.length * 2)
    for (const id of FONT_IDS) {
      expect(bytes[id].byteLength).toBeGreaterThan(0)
    }
  })
})
