import { readFileSync } from 'node:fs'
import path from 'node:path'
import { vi } from 'vitest'

/**
 * The browser-only pieces the real Editor needs in jsdom, shared by every
 * suite that mounts it (Editor, TemplateEditor, page): a FontFace that
 * "loads", a `document.fonts` that accepts it, and a `fetch` that serves
 * the five bundled faces from public/fonts so `createFontMetrics` parses
 * real TTFs. Call `installFontFixtures()` in `beforeEach`; the suite's
 * `vi.unstubAllGlobals()` in `afterEach` removes them.
 *
 * pdf.js is NOT stubbed here: `vi.mock` is hoisted per file, so each suite
 * keeps its own `vi.mock('pdfjs-dist', …)` -- use `fakePdfjsDocument()`
 * inside it to get the standard loading-task shape.
 */

export class FakeFontFace {
  constructor(
    public family: string,
    public source: unknown,
  ) {}
  async load() {
    return this
  }
}

export const FONT_DIR = path.resolve(__dirname, '../../public/fonts')

// Mirrors packages/core/src/fonts/registry.ts's FONT_FILES -- a literal
// here so this fixture never depends on the (possibly mocked) core module.
export const FONT_FILES = [
  'PT_Sans-Web-Regular.ttf',
  'PT_Sans-Web-Bold.ttf',
  'PT_Serif-Web-Regular.ttf',
  'PT_Serif-Web-Bold.ttf',
  'IBMPlexMono-Regular.ttf',
]

export function installFontFixtures(): void {
  vi.stubGlobal('FontFace', FakeFontFace)
  Object.defineProperty(document, 'fonts', { configurable: true, value: { add: vi.fn() } })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const file = FONT_FILES.find((f) => url.endsWith(f))
      if (!file) throw new Error(`unexpected fetch in test: ${url}`)
      const bytes = readFileSync(path.join(FONT_DIR, file))
      return {
        ok: true,
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      }
    }),
  )
}

/**
 * A pdf.js loading task whose single page paints instantly. Pass an
 * `onRender` to observe or hold each paint (see Editor.test.ts's
 * mid-paint case for a held one).
 */
export function fakePdfjsDocument(render: () => { promise: Promise<void>; cancel: () => void } = () => ({
  promise: Promise.resolve(),
  cancel: vi.fn(),
})) {
  return {
    promise: Promise.resolve({
      getPage: vi.fn(async () => ({
        getViewport: () => ({ width: 100, height: 100 }),
        render,
      })),
    }),
    destroy: vi.fn(),
  }
}
