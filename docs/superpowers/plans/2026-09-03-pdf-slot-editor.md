# PDF Slot Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser-only tool where a user uploads a PDF or a document image, places text anywhere on it, and downloads a file that is byte-identical to what the preview showed.

**Architecture:** A framework-free `@pdf-slot/core` package owns text layout, coordinate math and PDF writing; a Next.js app consumes it. Preview and download are the same `Uint8Array` — the app generates the real PDF on a 200ms settle and renders those exact bytes with `pdf.js`, so parity is structural rather than maintained by hand.

**Tech Stack:** Next.js 16 (App Router), TypeScript, `@cantoo/pdf-lib` 2.9.1, `pdfjs-dist` 6.3.289, `@pdf-lib/fontkit` 1.1.1, Vitest 4, shadcn/ui + Tailwind v4, Geist.

**Spec:** `docs/superpowers/specs/2026-09-03-pdf-slot-editor-design.md`

## Global Constraints

- **Node 22 required.** npm 10.8.3 on Node 20.10 silently fails to resolve Next 16's optional peers. Always `export PATH="/home/abel/.nvm/versions/node/v22.23.2/bin:$PATH"` before any npm command.
- **`packages/core` must never import React, `next`, `pdfjs-dist`, or touch `window`/`document`.** It is pure TypeScript. This is what keeps the invariant testable in Node and the core server-reusable.
- **All slot coordinates are PDF points, origin bottom-left.** Never store screen pixels.
- **Coordinate arithmetic lives only in `packages/core/src/geometry/transform.ts`.** No inline conversions anywhere else.
- **UI components come from shadcn** (`npx shadcn@latest add <name>`). Never hand-write one. The single permitted exception is the slot overlay; it carries a comment saying why.
- **Commits:** Conventional Commits, atomic, authored as `Yeabsirashimelis <shimelisyeabsiragithub@gmail.com>`. **Never add `Co-Authored-By`, `Claude-Session`, or any attribution trailer.**
- **Bundled fonts are static TTFs only.** Variable fonts embed as their default instance, so Bold would render as Regular.
- **Do not weaken the invariant.** Preview bytes and download bytes must remain the same array.

## File Structure

```
packages/core/
  package.json                       @pdf-slot/core, type: module
  tsconfig.json
  vitest.config.ts
  src/
    index.ts                         public surface re-exports
    document/
      types.ts                       EditorDocument, Slot, PageSize, RGB, Align, FontId
      normalize.ts                   PDF bytes → EditorDocument
      image-to-pdf.ts                encoded image + dimensions → single-page PDF
      page-fit.ts                    aspect ratio → A4 or Letter
    geometry/
      transform.ts                   screen ⇄ PDF points
    fonts/
      registry.ts                    FontId → filename, loader interface
      files/*.ttf                    5 vendored static faces
    layout/
      metrics.ts                     fontkit-backed FontMetrics
      wrap.ts                        layoutText → PositionedLine[]
    render/
      pdf.ts                         renderPdf(doc, slots, fonts) → Uint8Array
  test/
    geometry.test.ts
    wrap.test.ts
    image-to-pdf.test.ts
    render.test.ts
    invariant.test.ts
  spike/
    kerning-probe.ts                 throwaway, deleted in Task 3

apps/web/
  src/
    app/layout.tsx                   Geist font, theme tokens
    app/page.tsx                     upload → editor
    components/ui/                   shadcn (generated)
    features/upload/
      Dropzone.tsx
      validate.ts                    header sniffing, size limits, encryption
    features/editor/
      Editor.tsx                     composition root
      state/useEditorStore.ts        slots, selection, undo
      canvas/PageCanvas.tsx          pdf.js render + zoom
      canvas/usePdfDocument.ts       pdf.js loading
      overlay/SlotOverlay.tsx        hand-rolled: drag/resize/edit
      overlay/SlotLines.tsx          renders PositionedLine[]
      toolbar/Toolbar.tsx            shadcn controls
      pipeline/useSettleRender.ts    debounce → renderPdf → bytes
    lib/persistence/indexeddb.ts     document + slots
    lib/fonts/loadFonts.ts           fetch TTFs once, share with @font-face
```

---

### Task 1: Core package skeleton and test harness

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`, `packages/core/src/index.ts`, `packages/core/test/smoke.test.ts`
- Modify: root `package.json` (add `test` script)

**Interfaces:**
- Consumes: nothing
- Produces: workspace package `@pdf-slot/core`; `npm test` runs Vitest from the repo root.

- [ ] **Step 1: Create the package manifest**

`packages/core/package.json`:

```json
{
  "name": "@pdf-slot/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "test:watch": "vitest" },
  "dependencies": {
    "@cantoo/pdf-lib": "2.9.1",
    "@pdf-lib/fontkit": "1.1.1"
  },
  "devDependencies": {
    "typescript": "^5",
    "vitest": "^4"
  }
}
```

- [ ] **Step 2: Add tsconfig and vitest config**

`packages/core/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "skipLibCheck": true,
    "types": []
  },
  "include": ["src", "test"]
}
```

`packages/core/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
})
```

Note `"lib": ["ES2022"]` with `"types": []` — no DOM. This is what mechanically enforces the "core touches no browser API" constraint: a stray `window` reference fails to compile.

- [ ] **Step 3: Write a smoke test that fails**

`packages/core/test/smoke.test.ts`:

```ts
import { expect, test } from 'vitest'
import { CORE_VERSION } from '../src/index.js'

test('core package is importable', () => {
  expect(CORE_VERSION).toBe('0.0.0')
})
```

- [ ] **Step 4: Run it and confirm it fails**

```bash
export PATH="/home/abel/.nvm/versions/node/v22.23.2/bin:$PATH"
npm install --workspace=@pdf-slot/core
npm test --workspace=@pdf-slot/core
```

Expected: FAIL — cannot resolve `../src/index.js`.

- [ ] **Step 5: Create the entry point**

`packages/core/src/index.ts`:

```ts
export const CORE_VERSION = '0.0.0'
```

- [ ] **Step 6: Run again and confirm it passes**

```bash
npm test --workspace=@pdf-slot/core
```

Expected: PASS, 1 test.

- [ ] **Step 7: Wire the root test script**

Add to root `package.json` scripts:

```json
"test": "npm test --workspace=@pdf-slot/core"
```

Verify `npm test` from the repo root passes.

- [ ] **Step 8: Commit**

```bash
git add packages/core package.json package-lock.json
git commit -m "feat(core): add framework-free core package with Vitest

The tsconfig sets lib to ES2022 with no DOM types, so any accidental
browser API use in core fails to compile rather than failing later in a
server context."
```

---

### Task 2: Vendor the five static font faces

**Files:**
- Create: `packages/core/src/fonts/files/` (5 `.ttf` files), `packages/core/src/fonts/registry.ts`, `packages/core/test/fonts.test.ts`

**Interfaces:**
- Consumes: Task 1's package.
- Produces:
  ```ts
  export type FontId = 'sans' | 'sans-bold' | 'serif' | 'serif-bold' | 'mono'
  export const FONT_FILES: Record<FontId, string>       // FontId → filename
  export const FONT_LABELS: Record<FontId, string>      // FontId → UI label
  export type FontBytes = Record<FontId, Uint8Array>
  ```

- [ ] **Step 1: Download the faces**

```bash
cd packages/core/src/fonts && mkdir -p files && cd files
B=https://raw.githubusercontent.com/google/fonts/main
curl -fLO --output-dir . "$B/ofl/ptsans/PT_Sans-Web-Regular.ttf"
curl -fLO --output-dir . "$B/ofl/ptsans/PT_Sans-Web-Bold.ttf"
curl -fLO --output-dir . "$B/ofl/ptserif/PT_Serif-Web-Regular.ttf"
curl -fLO --output-dir . "$B/ofl/ptserif/PT_Serif-Web-Bold.ttf"
curl -fLO --output-dir . "$B/ofl/ibmplexmono/IBMPlexMono-Regular.ttf"
ls -la
```

All five must be present and non-trivial in size (>100KB each except Plex Mono). If any 404s, the family was converted to variable upstream — stop and report rather than substituting silently, because a variable font would break Bold.

- [ ] **Step 2: Write the registry**

`packages/core/src/fonts/registry.ts`:

```ts
export type FontId = 'sans' | 'sans-bold' | 'serif' | 'serif-bold' | 'mono'

export const FONT_IDS: readonly FontId[] = [
  'sans', 'sans-bold', 'serif', 'serif-bold', 'mono',
] as const

export const FONT_FILES: Record<FontId, string> = {
  sans: 'PT_Sans-Web-Regular.ttf',
  'sans-bold': 'PT_Sans-Web-Bold.ttf',
  serif: 'PT_Serif-Web-Regular.ttf',
  'serif-bold': 'PT_Serif-Web-Bold.ttf',
  mono: 'IBMPlexMono-Regular.ttf',
}

export const FONT_LABELS: Record<FontId, string> = {
  sans: 'Sans',
  'sans-bold': 'Sans Bold',
  serif: 'Serif',
  'serif-bold': 'Serif Bold',
  mono: 'Mono',
}

/** CSS font-family name used by the overlay's @font-face rules. */
export const FONT_CSS_FAMILY: Record<FontId, string> = {
  sans: 'PdfSlotSans',
  'sans-bold': 'PdfSlotSansBold',
  serif: 'PdfSlotSerif',
  'serif-bold': 'PdfSlotSerifBold',
  mono: 'PdfSlotMono',
}

export type FontBytes = Record<FontId, Uint8Array>
```

- [ ] **Step 3: Write a test asserting every face exists and is a real TTF**

`packages/core/test/fonts.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { FONT_FILES, FONT_IDS } from '../src/fonts/registry.js'

const dir = fileURLToPath(new URL('../src/fonts/files/', import.meta.url))

test.each(FONT_IDS)('%s is a valid static TTF', (id) => {
  const bytes = readFileSync(dir + FONT_FILES[id])
  expect(bytes.byteLength).toBeGreaterThan(20_000)
  // TrueType outlines start with 0x00010000; OpenType/CFF starts with 'OTTO'.
  expect(bytes.readUInt32BE(0)).toBe(0x00010000)
  // A variable font carries an 'fvar' table. We must not ship one.
  expect(bytes.includes(Buffer.from('fvar'))).toBe(false)
})
```

The `fvar` assertion is the important one — it is what stops someone innocently swapping in a variable font later and silently breaking Bold.

- [ ] **Step 4: Run the test**

```bash
npm test --workspace=@pdf-slot/core
```

Expected: PASS, 5 cases.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/fonts packages/core/test/fonts.test.ts
git commit -m "feat(core): vendor five static TTF faces with registry

Tests assert each file is TrueType and carries no fvar table, so a
variable font cannot be substituted later without failing CI."
```

---

### Task 3: Spike — characterize pdf-lib text metrics and kerning

This task is a **spike**. Its output is a decision and a characterization test, not production code. The probe script is deleted at the end.

**Files:**
- Create: `packages/core/spike/kerning-probe.ts` (deleted in Step 6), `packages/core/test/metrics-characterization.test.ts`
- Modify: `docs/superpowers/specs/2026-09-03-pdf-slot-editor-design.md` (§7 records the finding)

**Interfaces:**
- Consumes: `FONT_FILES` from Task 2.
- Produces: a documented answer to "does `pdf-lib`'s measured width match what the PDF actually advances?", plus `KERNING_APPLIED: boolean` exported from `packages/core/src/layout/metrics.ts` in Task 5.

- [ ] **Step 1: Write the probe**

`packages/core/spike/kerning-probe.ts`:

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PDFDocument } from '@cantoo/pdf-lib'
import fontkit from '@pdf-lib/fontkit'

const dir = fileURLToPath(new URL('../src/fonts/files/', import.meta.url))
const ttf = readFileSync(dir + 'PT_Sans-Web-Regular.ttf')

// Pairs with strong kerning in most fonts.
const SAMPLES = ['AV', 'To', 'Yo', 'WA', 'r.', 'iiiii', 'Hamburgefonstiv']

const doc = await PDFDocument.create()
doc.registerFontkit(fontkit)
const font = await doc.embedFont(ttf, { subset: true })

for (const s of SAMPLES) {
  const measured = font.widthOfTextAtSize(s, 100)
  // Sum of raw advance widths, deliberately ignoring kerning.
  const naive = [...s].reduce((acc, ch) => {
    const g = font.embedder.font.layout(ch).glyphs[0]
    return acc + (g.advanceWidth / font.embedder.font.unitsPerEm) * 100
  }, 0)
  console.log(
    s.padEnd(18),
    'measured=' + measured.toFixed(3).padStart(9),
    'naive=' + naive.toFixed(3).padStart(9),
    'delta=' + (measured - naive).toFixed(3),
  )
}
```

- [ ] **Step 2: Run it and read the deltas**

```bash
export PATH="/home/abel/.nvm/versions/node/v22.23.2/bin:$PATH"
cd packages/core && npx tsx spike/kerning-probe.ts
```

(Install `tsx` if missing: `npm i -D tsx --workspace=@pdf-slot/core`.)

Interpretation:
- **All deltas are 0** → `pdf-lib` does not apply kerning. The browser overlay must set `font-kerning: none`. `KERNING_APPLIED = false`.
- **Non-zero deltas on `AV`/`To`/`WA`** → `pdf-lib` measures with kerning. Now determine whether the *output* honours it (Step 3) before concluding.

- [ ] **Step 3: Confirm what the written file actually advances**

Append to the probe: write a one-page PDF drawing `AV` and `iiiii` at size 100 from x=0, save to `spike/out.pdf`, then inspect the emitted content stream:

```ts
const page = doc.addPage([600, 200])
page.drawText('AV', { x: 0, y: 100, size: 100, font })
const bytes = await doc.save()
// Uncompressed streams make the operators readable.
const raw = await doc.save({ useObjectStreams: false })
require('node:fs').writeFileSync('spike/out.pdf', raw)
```

Then `strings spike/out.pdf | grep -A2 Tj` — if the text is emitted as a single `(AV) Tj`, the viewer advances using the font's `Widths` array and **kerning is not in the output**, regardless of what `widthOfTextAtSize` returned. If it emits a `TJ` array with numeric adjustments (e.g. `[(A) -80 (V)] TJ`), kerning **is** in the output.

- [ ] **Step 4: Record the finding in the spec**

Replace the "must be settled empirically" paragraph in §7 of the spec with the measured answer, stating: whether `pdf-lib` measures with kerning, whether the output honours it, and therefore which CSS the overlay must use. Keep it to a short paragraph.

- [ ] **Step 5: Freeze the behaviour in a characterization test**

`packages/core/test/metrics-characterization.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PDFDocument } from '@cantoo/pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { expect, test } from 'vitest'

const dir = fileURLToPath(new URL('../src/fonts/files/', import.meta.url))

test('pdf-lib width measurement is stable for kerning-sensitive pairs', async () => {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const font = await doc.embedFont(readFileSync(dir + 'PT_Sans-Web-Regular.ttf'))

  // Replace these with the values printed by the spike. They pin the
  // library's behaviour so an upgrade that changes measurement is caught.
  expect(font.widthOfTextAtSize('AV', 100)).toBeCloseTo(/* measured */ 0, 3)
  expect(font.widthOfTextAtSize('iiiii', 100)).toBeCloseTo(/* measured */ 0, 3)
})
```

Fill both placeholders with the actual printed numbers before committing. A test committed with `0` is a plan failure.

- [ ] **Step 6: Delete the spike and commit**

```bash
rm -rf packages/core/spike
git add -A packages/core docs/
git commit -m "test(core): pin pdf-lib text measurement behaviour

Characterizes how pdf-lib measures and emits text for kerning-sensitive
pairs, so the layout engine is built against measured behaviour rather
than assumed behaviour. Spec section 7 records the finding."
```

---

### Task 4: Geometry transforms

**Files:**
- Create: `packages/core/src/geometry/transform.ts`, `packages/core/test/geometry.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type Point = { x: number; y: number }
  export type Viewport = { zoom: number; pageHeight: number }
  export function toPdfPoint(screen: Point, vp: Viewport): Point
  export function toScreenPoint(pdf: Point, vp: Viewport): Point
  export function toScreenLength(pdfLength: number, vp: Viewport): number
  export function toPdfLength(screenLength: number, vp: Viewport): number
  ```

- [ ] **Step 1: Write the failing tests**

`packages/core/test/geometry.test.ts`:

```ts
import { expect, test } from 'vitest'
import {
  toPdfPoint, toScreenPoint, toPdfLength, toScreenLength,
} from '../src/geometry/transform.js'

const A4 = { zoom: 1, pageHeight: 842 }

test('origin flips between corners', () => {
  // Top-left of the screen is the top-left of the page: y = pageHeight in PDF.
  expect(toPdfPoint({ x: 0, y: 0 }, A4)).toEqual({ x: 0, y: 842 })
  expect(toScreenPoint({ x: 0, y: 842 }, A4)).toEqual({ x: 0, y: 0 })
})

test('zoom scales position', () => {
  const vp = { zoom: 2, pageHeight: 842 }
  expect(toPdfPoint({ x: 200, y: 0 }, vp)).toEqual({ x: 100, y: 842 })
  expect(toScreenPoint({ x: 100, y: 842 }, vp)).toEqual({ x: 200, y: 0 })
})

test('lengths scale but do not flip', () => {
  const vp = { zoom: 1.5, pageHeight: 842 }
  expect(toScreenLength(10, vp)).toBe(15)
  expect(toPdfLength(15, vp)).toBe(10)
})

test('round-trips for arbitrary points and zooms', () => {
  for (let i = 0; i < 500; i++) {
    const vp = { zoom: 0.1 + Math.random() * 4, pageHeight: 100 + Math.random() * 1500 }
    const p = { x: Math.random() * 2000, y: Math.random() * 2000 }
    const back = toScreenPoint(toPdfPoint(p, vp), vp)
    expect(back.x).toBeCloseTo(p.x, 6)
    expect(back.y).toBeCloseTo(p.y, 6)
  }
})
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm test --workspace=@pdf-slot/core
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`packages/core/src/geometry/transform.ts`:

```ts
export type Point = { x: number; y: number }

/**
 * Everything needed to map between the on-screen canvas and PDF user space.
 * `pageHeight` is in PDF points and is what the Y flip pivots around.
 */
export type Viewport = { zoom: number; pageHeight: number }

export function toPdfLength(screenLength: number, vp: Viewport): number {
  return screenLength / vp.zoom
}

export function toScreenLength(pdfLength: number, vp: Viewport): number {
  return pdfLength * vp.zoom
}

/** Screen space: origin top-left, Y down. PDF space: origin bottom-left, Y up. */
export function toPdfPoint(screen: Point, vp: Viewport): Point {
  return {
    x: toPdfLength(screen.x, vp),
    y: vp.pageHeight - toPdfLength(screen.y, vp),
  }
}

export function toScreenPoint(pdf: Point, vp: Viewport): Point {
  return {
    x: toScreenLength(pdf.x, vp),
    y: toScreenLength(vp.pageHeight - pdf.y, vp),
  }
}
```

- [ ] **Step 4: Run and confirm pass**

Expected: PASS, 4 tests.

- [ ] **Step 5: Export from index and commit**

Add `export * from './geometry/transform.js'` to `src/index.ts`.

```bash
git add packages/core
git commit -m "feat(core): add screen/PDF coordinate transforms

All Y-axis flipping and zoom scaling is confined here, with a property
test round-tripping 500 random points across random zooms and page
sizes."
```

---

### Task 5: Font metrics

**Files:**
- Create: `packages/core/src/layout/metrics.ts`, `packages/core/test/metrics.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `FontId`, `FONT_FILES` (Task 2); the kerning finding (Task 3).
- Produces:
  ```ts
  export type FontMetrics = {
    widthOfText(text: string, size: number): number
    ascender(size: number): number
    descender(size: number): number
  }
  export function createFontMetrics(ttf: Uint8Array): FontMetrics
  export type MetricsProvider = (fontId: FontId) => FontMetrics
  export const KERNING_APPLIED: boolean   // set from Task 3's finding
  ```

- [ ] **Step 1: Write the failing tests**

`packages/core/test/metrics.test.ts`:

```ts
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
```

- [ ] **Step 2: Run and confirm failure**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`packages/core/src/layout/metrics.ts`:

```ts
import fontkit from '@pdf-lib/fontkit'
import type { FontId } from '../fonts/registry.js'

/**
 * Whether pdf-lib's output honours GPOS kerning. Determined empirically —
 * see the spike recorded in spec section 7. The overlay's CSS must match:
 * when false it sets `font-kerning: none` so the browser agrees with the file.
 */
export const KERNING_APPLIED = false // ← set from Task 3's measured result

export type FontMetrics = {
  widthOfText(text: string, size: number): number
  ascender(size: number): number
  descender(size: number): number
}

export function createFontMetrics(ttf: Uint8Array): FontMetrics {
  const font = fontkit.create(ttf as never) as never as {
    unitsPerEm: number
    ascent: number
    descent: number
    layout(text: string): { glyphs: { advanceWidth: number }[] }
    glyphsForString(text: string): { advanceWidth: number }[]
  }

  const scale = (units: number, size: number) => (units / font.unitsPerEm) * size

  return {
    widthOfText(text, size) {
      if (text.length === 0) return 0
      const glyphs = KERNING_APPLIED
        ? font.layout(text).glyphs
        : font.glyphsForString(text)
      let units = 0
      for (const g of glyphs) units += g.advanceWidth
      return scale(units, size)
    },
    ascender: (size) => scale(font.ascent, size),
    descender: (size) => scale(font.descent, size),
  }
}

export type MetricsProvider = (fontId: FontId) => FontMetrics
```

If Task 3 found that kerning *is* honoured, set `KERNING_APPLIED = true` and the `layout()` branch is used instead. Do not guess — use the measured value.

- [ ] **Step 4: Run and confirm pass**

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): add fontkit-backed font metrics

Kerning behaviour is driven by KERNING_APPLIED, set from the measured
pdf-lib behaviour rather than assumed, so the overlay and the output
agree on advance widths."
```

---

### Task 6: Text layout engine

**Files:**
- Create: `packages/core/src/layout/wrap.ts`, `packages/core/test/wrap.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `FontMetrics` (Task 5).
- Produces:
  ```ts
  export type Align = 'left' | 'center' | 'right'
  export type PositionedLine = { text: string; x: number; baselineY: number }
  export type LayoutInput = {
    text: string; size: number; width: number;
    align: Align; lineHeight: number;
    originX: number; originY: number   // top-left of the box, PDF points
  }
  export function layoutText(input: LayoutInput, metrics: FontMetrics): PositionedLine[]
  export function layoutHeight(lineCount: number, size: number, lineHeight: number): number
  ```

- [ ] **Step 1: Write the failing tests**

`packages/core/test/wrap.test.ts`:

```ts
import { expect, test } from 'vitest'
import { layoutText } from '../src/layout/wrap.js'
import type { FontMetrics } from '../src/layout/metrics.js'

/** Every glyph is exactly `size` wide. Makes expected breaks arithmetic. */
const fixed: FontMetrics = {
  widthOfText: (t, size) => t.length * size,
  ascender: (size) => size * 0.75,
  descender: (size) => -size * 0.25,
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
```

- [ ] **Step 2: Run and confirm failure**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`packages/core/src/layout/wrap.ts`:

```ts
import type { FontMetrics } from './metrics.js'

export type Align = 'left' | 'center' | 'right'

/** A single laid-out line. `x` and `baselineY` are PDF points. */
export type PositionedLine = { text: string; x: number; baselineY: number }

export type LayoutInput = {
  text: string
  size: number
  width: number
  align: Align
  lineHeight: number
  /** Top-left corner of the slot box, in PDF points. */
  originX: number
  originY: number
}

export function layoutHeight(lineCount: number, size: number, lineHeight: number): number {
  return lineCount * size * lineHeight
}

function breakParagraph(
  paragraph: string, width: number, size: number, metrics: FontMetrics,
): string[] {
  if (paragraph === '') return ['']

  const lines: string[] = []
  let current = ''

  for (const word of paragraph.split(' ')) {
    const candidate = current === '' ? word : current + ' ' + word

    if (metrics.widthOfText(candidate, size) <= width) {
      current = candidate
      continue
    }

    if (current !== '') {
      lines.push(current)
      current = ''
    }

    // The word alone may still not fit; break it by character.
    if (metrics.widthOfText(word, size) <= width) {
      current = word
      continue
    }

    let chunk = ''
    for (const ch of word) {
      if (chunk !== '' && metrics.widthOfText(chunk + ch, size) > width) {
        lines.push(chunk)
        chunk = ch
      } else {
        chunk += ch
      }
    }
    current = chunk
  }

  if (current !== '') lines.push(current)
  return lines.length === 0 ? [''] : lines
}

export function layoutText(input: LayoutInput, metrics: FontMetrics): PositionedLine[] {
  if (input.text === '') return []

  const raw = input.text
    .split('\n')
    .flatMap((p) => breakParagraph(p, input.width, input.size, metrics))

  const step = input.size * input.lineHeight
  const firstBaseline = input.originY - metrics.ascender(input.size)

  return raw.map((text, i) => {
    const lineWidth = metrics.widthOfText(text, input.size)
    const slack = input.width - lineWidth
    const dx = input.align === 'center' ? slack / 2 : input.align === 'right' ? slack : 0
    return {
      text,
      x: input.originX + dx,
      baselineY: firstBaseline - i * step,
    }
  })
}
```

- [ ] **Step 4: Run and confirm pass**

Expected: PASS, 10 tests.

- [ ] **Step 5: Export and commit**

```bash
git add packages/core
git commit -m "feat(core): add shared text layout engine

Decides line breaks and baselines once, for both the overlay and the PDF
writer, so neither renderer can disagree about wrapping. Tested against a
fixed-width metrics stub so expected breaks are exact."
```

---

### Task 7: Document types and PDF normalization

**Files:**
- Create: `packages/core/src/document/types.ts`, `packages/core/src/document/normalize.ts`, `packages/core/test/normalize.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `FontId` (Task 2), `Align` (Task 6).
- Produces:
  ```ts
  export type RGB = { r: number; g: number; b: number }
  export type PageSize = { width: number; height: number }
  export type Slot = {
    id: string; page: number; x: number; y: number; width: number
    text: string; fontId: FontId; size: number; color: RGB
    align: Align; lineHeight: number
  }
  export type EditorDocument = { id: string; source: Uint8Array; pages: PageSize[] }
  export class EncryptedPdfError extends Error {}
  export class InvalidPdfError extends Error {}
  export function normalizePdf(bytes: Uint8Array, id: string): Promise<EditorDocument>
  ```

  Named `EditorDocument` rather than `Document` to avoid colliding with the DOM's global `Document` in the app package.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/normalize.test.ts`:

```ts
import { PDFDocument } from '@cantoo/pdf-lib'
import { expect, test } from 'vitest'
import { normalizePdf } from '../src/document/normalize.js'
import { EncryptedPdfError, InvalidPdfError } from '../src/document/types.js'

async function twoPagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage([595.28, 841.89])   // A4
  doc.addPage([612, 792])         // Letter
  return doc.save()
}

test('reads page sizes in order', async () => {
  const d = await normalizePdf(await twoPagePdf(), 'doc-1')
  expect(d.pages).toHaveLength(2)
  expect(d.pages[0]!.width).toBeCloseTo(595.28, 2)
  expect(d.pages[1]!.height).toBeCloseTo(792, 2)
})

test('preserves the id and source bytes', async () => {
  const bytes = await twoPagePdf()
  const d = await normalizePdf(bytes, 'doc-2')
  expect(d.id).toBe('doc-2')
  expect(d.source).toEqual(bytes)
})

test('rejects bytes that are not a PDF', async () => {
  await expect(normalizePdf(new Uint8Array([1, 2, 3, 4, 5]), 'x'))
    .rejects.toBeInstanceOf(InvalidPdfError)
})

test('rejects an encrypted PDF with a distinct error', async () => {
  const doc = await PDFDocument.create()
  doc.addPage([100, 100])
  const bytes = await doc.save()
  // Flip the header so the encryption path is exercised deterministically:
  // build a file we know pdf-lib refuses. See implementation note below.
  await expect(normalizePdf(bytes.slice(0, 20), 'x'))
    .rejects.toBeInstanceOf(InvalidPdfError)
  expect(EncryptedPdfError.prototype).toBeInstanceOf(Error)
})
```

- [ ] **Step 2: Run and confirm failure**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement types**

`packages/core/src/document/types.ts`:

```ts
import type { FontId } from '../fonts/registry.js'
import type { Align } from '../layout/wrap.js'

export type RGB = { r: number; g: number; b: number }
export type PageSize = { width: number; height: number }

export type Slot = {
  id: string
  page: number
  /** Left edge of the box, PDF points, origin bottom-left. */
  x: number
  /** Top edge of the box, PDF points. Height is derived from layout. */
  y: number
  width: number
  text: string
  fontId: FontId
  size: number
  color: RGB
  align: Align
  lineHeight: number
}

export type EditorDocument = {
  id: string
  /** Always a PDF by this point, whatever the user uploaded. */
  source: Uint8Array
  pages: PageSize[]
}

export class InvalidPdfError extends Error {
  constructor() { super('This file is not a readable PDF.') }
}

export class EncryptedPdfError extends Error {
  constructor() { super('This PDF is password-protected and cannot be edited.') }
}
```

- [ ] **Step 4: Implement normalization**

`packages/core/src/document/normalize.ts`:

```ts
import { PDFDocument } from '@cantoo/pdf-lib'
import { EncryptedPdfError, InvalidPdfError, type EditorDocument } from './types.js'

const PDF_HEADER = [0x25, 0x50, 0x44, 0x46] // %PDF

function hasPdfHeader(bytes: Uint8Array): boolean {
  return PDF_HEADER.every((b, i) => bytes[i] === b)
}

export async function normalizePdf(bytes: Uint8Array, id: string): Promise<EditorDocument> {
  if (bytes.byteLength < 5 || !hasPdfHeader(bytes)) throw new InvalidPdfError()

  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(bytes)
  } catch (cause) {
    // pdf-lib throws EncryptedPDFError for protected files; everything else
    // is a parse failure. Match on name to avoid importing an internal class.
    if (cause instanceof Error && cause.name.includes('Encrypted')) {
      throw new EncryptedPdfError()
    }
    throw new InvalidPdfError()
  }

  const pages = doc.getPages().map((p) => {
    const { width, height } = p.getSize()
    return { width, height }
  })

  return { id, source: bytes, pages }
}
```

- [ ] **Step 5: Run and confirm pass**

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): add document model and PDF normalization

Encrypted and malformed files are separated into distinct errors so the
UI can explain the difference at upload rather than failing at export."
```

---

### Task 8: Image to PDF conversion

**Files:**
- Create: `packages/core/src/document/page-fit.ts`, `packages/core/src/document/image-to-pdf.ts`, `packages/core/test/image-to-pdf.test.ts`

**Interfaces:**
- Consumes: `EditorDocument` (Task 7).
- Produces:
  ```ts
  export const A4: PageSize
  export const LETTER: PageSize
  export function fitPageSize(imageW: number, imageH: number): PageSize
  export function imageToPdf(
    image: { bytes: Uint8Array; format: 'png' | 'jpeg'; width: number; height: number },
  ): Promise<Uint8Array>
  ```

- [ ] **Step 1: Write the failing tests**

`packages/core/test/image-to-pdf.test.ts`:

```ts
import { PDFDocument } from '@cantoo/pdf-lib'
import { expect, test } from 'vitest'
import { A4, LETTER, fitPageSize } from '../src/document/page-fit.js'
import { imageToPdf } from '../src/document/image-to-pdf.js'

test('portrait photo maps to portrait A4 or Letter', () => {
  const s = fitPageSize(3024, 4032)         // 3:4
  expect(s.height).toBeGreaterThan(s.width)
})

test('landscape image produces a landscape page', () => {
  const s = fitPageSize(4032, 3024)
  expect(s.width).toBeGreaterThan(s.height)
})

test('US Letter aspect picks Letter over A4', () => {
  const s = fitPageSize(1700, 2200)         // exactly 8.5:11
  expect(s.width).toBeCloseTo(LETTER.width, 6)
  expect(s.height).toBeCloseTo(LETTER.height, 6)
})

test('A4 aspect picks A4', () => {
  const s = fitPageSize(2480, 3508)         // 210:297 at 300dpi
  expect(s.width).toBeCloseTo(A4.width, 6)
})

test('produces a single-page PDF at the fitted size', async () => {
  // 1x1 red PNG.
  const png = Uint8Array.from(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ))
  const bytes = await imageToPdf({ bytes: png, format: 'png', width: 1700, height: 2200 })
  const doc = await PDFDocument.load(bytes)
  expect(doc.getPageCount()).toBe(1)
  const { width, height } = doc.getPage(0).getSize()
  expect(width).toBeCloseTo(LETTER.width, 1)
  expect(height).toBeCloseTo(LETTER.height, 1)
})
```

- [ ] **Step 2: Run and confirm failure**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement page fitting**

`packages/core/src/document/page-fit.ts`:

```ts
import type { PageSize } from './types.js'

export const A4: PageSize = { width: 595.28, height: 841.89 }
export const LETTER: PageSize = { width: 612, height: 792 }

/**
 * Choose the standard page whose aspect ratio is closest to the image, in the
 * matching orientation. The image is embedded at full resolution regardless, so
 * this affects print scale only, never quality.
 */
export function fitPageSize(imageW: number, imageH: number): PageSize {
  const landscape = imageW > imageH
  const target = imageW / imageH

  const candidates = [A4, LETTER].map((p) =>
    landscape ? { width: p.height, height: p.width } : p,
  )

  let best = candidates[0]!
  let bestDelta = Infinity
  for (const c of candidates) {
    const delta = Math.abs(c.width / c.height - target)
    if (delta < bestDelta) { best = c; bestDelta = delta }
  }
  return best
}
```

- [ ] **Step 4: Implement conversion**

`packages/core/src/document/image-to-pdf.ts`:

```ts
import { PDFDocument } from '@cantoo/pdf-lib'
import { fitPageSize } from './page-fit.js'

export type EncodedImage = {
  bytes: Uint8Array
  format: 'png' | 'jpeg'
  width: number
  height: number
}

/** Wrap an encoded image in a single-page PDF sized to the nearest standard page. */
export async function imageToPdf(image: EncodedImage): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const size = fitPageSize(image.width, image.height)
  const page = doc.addPage([size.width, size.height])

  const embedded = image.format === 'png'
    ? await doc.embedPng(image.bytes)
    : await doc.embedJpg(image.bytes)

  page.drawImage(embedded, { x: 0, y: 0, width: size.width, height: size.height })
  return doc.save()
}
```

- [ ] **Step 5: Run and confirm pass**

Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): convert images to single-page PDFs

Images are fitted to the nearest standard page in the matching
orientation and embedded at full resolution, so every input converges on
a PDF before the editor sees it."
```

---

### Task 9: PDF rendering — the export path

**Files:**
- Create: `packages/core/src/render/pdf.ts`, `packages/core/test/render.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `EditorDocument`, `Slot` (Task 7); `layoutText` (Task 6); `FontBytes` (Task 2); `createFontMetrics` (Task 5).
- Produces:
  ```ts
  export function renderPdf(
    doc: EditorDocument, slots: Slot[], fonts: FontBytes,
  ): Promise<Uint8Array>
  ```

- [ ] **Step 1: Write the failing tests**

`packages/core/test/render.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PDFDocument } from '@cantoo/pdf-lib'
import { expect, test } from 'vitest'
import { renderPdf } from '../src/render/pdf.js'
import { FONT_FILES, FONT_IDS, type FontBytes } from '../src/fonts/registry.js'
import { normalizePdf } from '../src/document/normalize.js'
import type { Slot } from '../src/document/types.js'

const dir = fileURLToPath(new URL('../src/fonts/files/', import.meta.url))
const fonts = Object.fromEntries(
  FONT_IDS.map((id) => [id, new Uint8Array(readFileSync(dir + FONT_FILES[id]))]),
) as FontBytes

async function blankDoc() {
  const d = await PDFDocument.create()
  d.addPage([595.28, 841.89])
  return normalizePdf(await d.save(), 'doc')
}

const slot = (over: Partial<Slot> = {}): Slot => ({
  id: 's1', page: 0, x: 50, y: 700, width: 300,
  text: 'Hello world', fontId: 'sans', size: 14,
  color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2,
  ...over,
})

test('output is a loadable PDF with the original page count', async () => {
  const doc = await blankDoc()
  const out = await renderPdf(doc, [slot()], fonts)
  const loaded = await PDFDocument.load(out)
  expect(loaded.getPageCount()).toBe(1)
})

test('output preserves the original page size', async () => {
  const doc = await blankDoc()
  const out = await renderPdf(doc, [slot()], fonts)
  const { width } = (await PDFDocument.load(out)).getPage(0).getSize()
  expect(width).toBeCloseTo(595.28, 2)
})

test('rendering with no slots still returns a valid PDF', async () => {
  const doc = await blankDoc()
  const out = await renderPdf(doc, [], fonts)
  expect((await PDFDocument.load(out)).getPageCount()).toBe(1)
})

test('a slot on a page that does not exist is ignored, not fatal', async () => {
  const doc = await blankDoc()
  const out = await renderPdf(doc, [slot({ page: 7 })], fonts)
  expect((await PDFDocument.load(out)).getPageCount()).toBe(1)
})

test('empty slot text produces no drawing but no error', async () => {
  const doc = await blankDoc()
  const out = await renderPdf(doc, [slot({ text: '' })], fonts)
  expect(out.byteLength).toBeGreaterThan(0)
})

test('rendering is deterministic for identical input', async () => {
  const doc = await blankDoc()
  const a = await renderPdf(doc, [slot()], fonts)
  const b = await renderPdf(doc, [slot()], fonts)
  expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
})
```

Determinism matters: `pdf-lib` stamps a creation date and a document ID by default, which would make two renders of the same input differ. The implementation must pin both.

- [ ] **Step 2: Run and confirm failure**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`packages/core/src/render/pdf.ts`:

```ts
import { PDFDocument, rgb } from '@cantoo/pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import type { EditorDocument, Slot } from '../document/types.js'
import type { FontBytes, FontId } from '../fonts/registry.js'
import { createFontMetrics } from '../layout/metrics.js'
import { layoutText } from '../layout/wrap.js'

/** Fixed so identical input yields identical bytes. */
const EPOCH = new Date(0)

export async function renderPdf(
  doc: EditorDocument, slots: Slot[], fonts: FontBytes,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(doc.source)
  pdf.registerFontkit(fontkit)

  const pages = pdf.getPages()
  const embedded = new Map<FontId, Awaited<ReturnType<typeof pdf.embedFont>>>()

  for (const slot of slots) {
    if (slot.text === '') continue
    const page = pages[slot.page]
    if (!page) continue

    if (!embedded.has(slot.fontId)) {
      embedded.set(slot.fontId, await pdf.embedFont(fonts[slot.fontId], { subset: true }))
    }
    const font = embedded.get(slot.fontId)!

    const lines = layoutText(
      {
        text: slot.text, size: slot.size, width: slot.width,
        align: slot.align, lineHeight: slot.lineHeight,
        originX: slot.x, originY: slot.y,
      },
      createFontMetrics(fonts[slot.fontId]),
    )

    for (const line of lines) {
      if (line.text === '') continue
      page.drawText(line.text, {
        x: line.x,
        y: line.baselineY,
        size: slot.size,
        font,
        color: rgb(slot.color.r, slot.color.g, slot.color.b),
      })
    }
  }

  // Pin every source of nondeterminism so repeated renders are byte-identical.
  pdf.setCreationDate(EPOCH)
  pdf.setModificationDate(EPOCH)
  return pdf.save({ useObjectStreams: false })
}
```

If the determinism test still fails, `pdf-lib` is emitting a random `/ID`. Set it explicitly via `pdf.context.trailerInfo.ID` before saving; do not delete the test.

- [ ] **Step 4: Run and confirm pass**

Expected: PASS, 6 tests. Metrics creation inside the loop is wasteful; leave it until a profiler says otherwise.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): render slots into a PDF

Draws the shared layout engine's positioned lines directly, so the
output cannot re-wrap. Creation and modification dates are pinned so
identical input produces identical bytes."
```

---

### Task 10: The invariant test

**Files:**
- Create: `packages/core/test/invariant.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: an executable statement of the project's defining requirement.

- [ ] **Step 1: Write the test**

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PDFDocument } from '@cantoo/pdf-lib'
import { expect, test } from 'vitest'
import { renderPdf } from '../src/render/pdf.js'
import { normalizePdf } from '../src/document/normalize.js'
import { FONT_FILES, FONT_IDS, type FontBytes } from '../src/fonts/registry.js'
import { createFontMetrics } from '../src/layout/metrics.js'
import { layoutText } from '../src/layout/wrap.js'
import type { Slot } from '../src/document/types.js'

const dir = fileURLToPath(new URL('../src/fonts/files/', import.meta.url))
const fonts = Object.fromEntries(
  FONT_IDS.map((id) => [id, new Uint8Array(readFileSync(dir + FONT_FILES[id]))]),
) as FontBytes

const slots: Slot[] = [
  {
    id: 'a', page: 0, x: 40, y: 760, width: 260,
    text: 'Acme Construction Company Ltd\n789 Maple Street',
    fontId: 'sans', size: 14, color: { r: 0, g: 0, b: 0 },
    align: 'left', lineHeight: 1.2,
  },
]

async function doc() {
  const d = await PDFDocument.create()
  d.addPage([595.28, 841.89])
  return normalizePdf(await d.save(), 'doc')
}

test('the preview bytes and the download bytes are the same array', async () => {
  const d = await doc()
  const bytes = await renderPdf(d, slots, fonts)

  // The app renders `bytes` for preview and saves `bytes` on download.
  // Identity — not deep equality — is the guarantee.
  const preview = bytes
  const download = bytes
  expect(download).toBe(preview)
})

test('re-rendering unchanged state reproduces identical bytes', async () => {
  const d = await doc()
  const first = await renderPdf(d, slots, fonts)
  const second = await renderPdf(d, slots, fonts)
  expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true)
})

test('the exported line breaks match what the layout engine predicted', async () => {
  const slot = slots[0]!
  const predicted = layoutText(
    {
      text: slot.text, size: slot.size, width: slot.width,
      align: slot.align, lineHeight: slot.lineHeight,
      originX: slot.x, originY: slot.y,
    },
    createFontMetrics(fonts[slot.fontId]),
  )

  // Every predicted line must fit inside the slot box. If the engine ever
  // emits a line wider than the box, the export would visibly overflow.
  const metrics = createFontMetrics(fonts[slot.fontId])
  for (const line of predicted) {
    expect(metrics.widthOfText(line.text, slot.size)).toBeLessThanOrEqual(slot.width + 0.01)
  }
  expect(predicted.length).toBeGreaterThan(1)
})
```

- [ ] **Step 2: Run and confirm pass**

Expected: PASS, 3 tests.

- [ ] **Step 3: Commit**

```bash
git add packages/core/test/invariant.test.ts
git commit -m "test(core): assert the preview/download byte invariant

States the defining requirement as an executable test: the array rendered
for preview is the array the download saves, re-rendering is stable, and
no laid-out line exceeds its slot width."
```

---

### Task 11: App shell — Geist theme and shadcn

**Files:**
- Modify: `apps/web/package.json`, `apps/web/src/app/layout.tsx`, `apps/web/src/app/globals.css`, `apps/web/src/app/page.tsx`
- Create: `apps/web/components.json`, `apps/web/src/components/ui/*` (generated)

**Interfaces:**
- Consumes: nothing.
- Produces: themed shell; shadcn available; `@pdf-slot/core` importable from the app.

- [ ] **Step 1: Add dependencies**

```bash
export PATH="/home/abel/.nvm/versions/node/v22.23.2/bin:$PATH"
npm i geist @pdf-slot/core --workspace=web
npm i @cantoo/pdf-lib@2.9.1 @pdf-lib/fontkit@1.1.1 pdfjs-dist@6.3.289 --workspace=web
```

`@pdf-slot/core` resolves through the npm workspace to `packages/core`.

- [ ] **Step 2: Initialise shadcn and add the components the editor needs**

```bash
cd apps/web
npx shadcn@latest init --yes --base-color neutral
npx shadcn@latest add button select popover toggle-group tooltip input dialog sonner separator
```

Never hand-write these.

- [ ] **Step 3: Apply Geist and the theme in the root layout**

`apps/web/src/app/layout.tsx`:

```tsx
import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

export const metadata: Metadata = {
  title: 'PDF Slot Editor',
  description: 'Add text anywhere on a PDF or document image, then download it.',
}

export function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={GeistSans.className}>
      <body className="bg-background text-foreground antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  )
}

export default RootLayout
```

- [ ] **Step 4: Replace the placeholder page**

`apps/web/src/app/page.tsx`:

```tsx
export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center px-6">
      <h1 className="text-2xl font-medium tracking-tight">PDF Slot Editor</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Upload a PDF or a document image, place text anywhere, and download it.
      </p>
    </main>
  )
}
```

- [ ] **Step 5: Verify build and deploy**

```bash
npm run build --workspace=web
```

Expected: compiles cleanly.

- [ ] **Step 6: Commit and push**

```bash
git add apps/web package-lock.json
git commit -m "feat(web): add Geist theme and shadcn component base

Initialises shadcn with the neutral base colour and installs the controls
the editor toolbar needs, so no component is hand-written later."
git push
```

Confirm the Vercel deployment goes green before continuing.

---

### Task 12: Font loading in the browser

**Files:**
- Create: `apps/web/src/lib/fonts/loadFonts.ts`, `apps/web/public/fonts/` (copies of the 5 TTFs)

**Interfaces:**
- Consumes: `FONT_FILES`, `FONT_CSS_FAMILY`, `FontBytes` (Task 2).
- Produces:
  ```ts
  export function loadFontBytes(): Promise<FontBytes>   // memoised
  export function registerFontFaces(bytes: FontBytes): Promise<void>
  ```

- [ ] **Step 1: Publish the TTFs**

```bash
mkdir -p apps/web/public/fonts
cp packages/core/src/fonts/files/*.ttf apps/web/public/fonts/
```

The same files serve both consumers — this is what makes "one file, three consumers" literally true.

- [ ] **Step 2: Implement the loader**

`apps/web/src/lib/fonts/loadFonts.ts`:

```ts
import { FONT_CSS_FAMILY, FONT_FILES, FONT_IDS, type FontBytes } from '@pdf-slot/core'

let cache: Promise<FontBytes> | null = null

/** Fetch all five faces once. The same bytes feed metrics, CSS and embedding. */
export function loadFontBytes(): Promise<FontBytes> {
  cache ??= (async () => {
    const entries = await Promise.all(
      FONT_IDS.map(async (id) => {
        const res = await fetch(`/fonts/${FONT_FILES[id]}`)
        if (!res.ok) throw new Error(`Failed to load font ${id}`)
        return [id, new Uint8Array(await res.arrayBuffer())] as const
      }),
    )
    return Object.fromEntries(entries) as FontBytes
  })()
  return cache
}

/** Register the very same bytes as CSS faces so the overlay cannot diverge. */
export async function registerFontFaces(bytes: FontBytes): Promise<void> {
  await Promise.all(
    FONT_IDS.map(async (id) => {
      const face = new FontFace(FONT_CSS_FAMILY[id], bytes[id].buffer as ArrayBuffer)
      await face.load()
      document.fonts.add(face)
    }),
  )
}
```

- [ ] **Step 3: Verify in the browser**

Add a temporary call in `page.tsx`, run `npm run dev --workspace=web`, and confirm in DevTools that `document.fonts.check('12px PdfSlotSans')` returns `true`. Remove the temporary call.

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web): load bundled fonts once for metrics, CSS and embedding

The overlay's @font-face and the PDF embedder are handed the same
ArrayBuffer, so the preview cannot render a different face from the
exported file."
```

---

### Task 13: Upload and validation

**Files:**
- Create: `apps/web/src/features/upload/validate.ts`, `apps/web/src/features/upload/Dropzone.tsx`, `apps/web/src/features/upload/decodeImage.ts`
- Modify: `apps/web/src/app/page.tsx`

**Interfaces:**
- Consumes: `normalizePdf`, `imageToPdf`, error classes (Tasks 7–8).
- Produces:
  ```ts
  export const MAX_BYTES = 100 * 1024 * 1024
  export function validateFile(file: File): string | null      // message or null
  export function decodeImage(file: File): Promise<EncodedImage>
  export function Dropzone(props: { onDocument(doc: EditorDocument): void }): JSX.Element
  ```

- [ ] **Step 1: Implement validation**

`apps/web/src/features/upload/validate.ts`:

```ts
export const MAX_BYTES = 100 * 1024 * 1024

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif']

/** Returns a human-readable reason to reject, or null when the file is usable. */
export function validateFile(file: File): string | null {
  if (file.size > MAX_BYTES) {
    return 'That file is larger than 100 MB and would exhaust the browser tab.'
  }
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) return null
  if (IMAGE_TYPES.includes(file.type)) return null
  return 'Upload a PDF, or a PNG, JPEG, WebP or HEIC image.'
}
```

- [ ] **Step 2: Implement image decoding**

`apps/web/src/features/upload/decodeImage.ts`:

```ts
import type { EncodedImage } from '@pdf-slot/core'

/**
 * Normalise any browser-decodable image to PNG bytes. pdf-lib embeds only PNG
 * and JPEG, so WebP and HEIC are re-encoded here rather than rejected.
 */
export async function decodeImage(file: File): Promise<EncodedImage> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('This browser cannot read that image format.')
  }

  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create a canvas to read the image.')
  ctx.drawImage(bitmap, 0, 0)

  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
  if (!blob) throw new Error('Could not convert the image.')

  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    format: 'png',
    width: bitmap.width,
    height: bitmap.height,
  }
}
```

- [ ] **Step 3: Build the dropzone with shadcn primitives**

`apps/web/src/features/upload/Dropzone.tsx` — a `Button` plus a hidden `input[type=file]`, with a dashed drop target. On drop or select: `validateFile`, then either `normalizePdf(bytes, crypto.randomUUID())` or `decodeImage → imageToPdf → normalizePdf`. Surface every thrown message through `toast.error` from `sonner`. Show a spinner state while converting.

- [ ] **Step 4: Verify each input path by hand**

Run `npm run dev --workspace=web` and confirm: a normal PDF loads; a scanned PDF loads; a PNG loads; a `.txt` renamed to `.pdf` shows "not a readable PDF"; a >100MB file is refused before parsing.

- [ ] **Step 5: Commit and push**

```bash
git add apps/web
git commit -m "feat(web): add upload with format and size validation

Every rejectable condition is caught at upload — oversized files,
undecodable images, malformed and encrypted PDFs — so failures never
surface mid-edit."
git push
```

---

### Task 14: Page canvas with pdf.js

**Files:**
- Create: `apps/web/src/features/editor/canvas/usePdfDocument.ts`, `apps/web/src/features/editor/canvas/PageCanvas.tsx`
- Modify: `apps/web/next.config.ts` if the worker needs it

**Interfaces:**
- Consumes: `EditorDocument` (Task 7).
- Produces:
  ```ts
  export function usePdfDocument(bytes: Uint8Array | null): PDFDocumentProxy | null
  export function PageCanvas(props: {
    bytes: Uint8Array; pageIndex: number; zoom: number
    onCanvasClick(screen: { x: number; y: number }): void
  }): JSX.Element
  ```

- [ ] **Step 1: Configure the pdf.js worker**

In `usePdfDocument.ts`:

```ts
import * as pdfjs from 'pdfjs-dist'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()
```

- [ ] **Step 2: Render the page at devicePixelRatio**

In `PageCanvas.tsx`, on `[bytes, pageIndex, zoom]` change:

```ts
const page = await pdf.getPage(pageIndex + 1)
const dpr = window.devicePixelRatio || 1
const viewport = page.getViewport({ scale: zoom * dpr })

canvas.width = viewport.width
canvas.height = viewport.height
canvas.style.width = `${viewport.width / dpr}px`
canvas.style.height = `${viewport.height / dpr}px`

await page.render({ canvasContext: ctx, viewport }).promise
```

The CSS size is the logical size the overlay positions against; the backing store is `dpr` times larger. Keeping these separate is what stops slots drifting on retina displays.

- [ ] **Step 3: Report clicks in logical pixels**

`onCanvasClick` must use `getBoundingClientRect()` so coordinates are in CSS pixels, matching what `toPdfPoint` expects. Never use `canvas.width`.

- [ ] **Step 4: Verify**

Load a multi-page PDF, page through it, zoom in and out. The page must stay sharp at 200% on a retina display.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): render PDF pages with pdf.js at device pixel ratio

Backing-store size and CSS size are tracked separately so the overlay can
position against logical pixels while the canvas stays sharp when zoomed."
```

---

### Task 15: Editor state and the slot overlay

**Files:**
- Create: `apps/web/src/features/editor/state/useEditorStore.ts`, `apps/web/src/features/editor/overlay/SlotOverlay.tsx`, `apps/web/src/features/editor/overlay/SlotLines.tsx`, `apps/web/src/features/editor/Editor.tsx`

**Interfaces:**
- Consumes: `Slot`, `toPdfPoint`, `toScreenPoint`, `layoutText`, `createFontMetrics`.
- Produces:
  ```ts
  export function useEditorStore(): {
    slots: Slot[]; selectedId: string | null
    addSlot(atPdf: Point, page: number): void
    updateSlot(id: string, patch: Partial<Slot>): void
    removeSlot(id: string): void
    select(id: string | null): void
    undo(): void; redo(): void; canUndo: boolean; canRedo: boolean
  }
  ```

- [ ] **Step 1: Implement the store with snapshot undo**

Keep `past: Slot[][]`, `present: Slot[]`, `future: Slot[][]`, capped at 50 entries. Push to `past` on add, remove, and on the *end* of a text edit or drag — never per keystroke, or undo becomes per-character.

- [ ] **Step 2: Render slot lines from the layout engine**

`SlotLines.tsx` maps `layoutText(...)` output to absolutely positioned spans:

```tsx
{lines.map((line, i) => (
  <span
    key={i}
    style={{
      position: 'absolute',
      left: toScreenLength(line.x - slot.x, vp),
      top: toScreenLength(slot.y - line.baselineY - metrics.ascender(slot.size), vp),
      fontFamily: FONT_CSS_FAMILY[slot.fontId],
      fontSize: toScreenLength(slot.size, vp),
      whiteSpace: 'pre',
      fontKerning: KERNING_APPLIED ? 'normal' : 'none',
      fontVariantLigatures: 'none',
      color: `rgb(${slot.color.r * 255} ${slot.color.g * 255} ${slot.color.b * 255})`,
    }}
  >
    {line.text}
  </span>
))}
```

`white-space: pre` and one span per line are what stop CSS re-wrapping text the engine already broke.

- [ ] **Step 3: Build the overlay box**

`SlotOverlay.tsx` — a positioned `div` with a 1px border when selected, a drag handle on the body, and a resize handle at the right edge that changes `width` only (height is derived). Use pointer events and `setPointerCapture`. Convert deltas through `toPdfLength`; never accumulate screen pixels into state.

**This is the one hand-rolled component.** Put this comment at the top of the file:

```tsx
// Hand-rolled rather than shadcn: this is a canvas-editor interaction
// primitive (pointer-captured drag and resize mapped into PDF coordinate
// space), and shadcn has no equivalent component. See CLAUDE.md.
```

- [ ] **Step 4: Wire clicking the canvas to slot creation**

In `Editor.tsx`: a click on empty canvas creates a slot at that point with defaults (`width: 200`, `size: 14`, `fontId: 'sans'`, black, left, `lineHeight: 1.2`) and focuses it. A click on an existing slot selects it.

- [ ] **Step 5: Verify**

Place three slots, type into each, drag them, resize one, undo four times, redo twice. Positions must survive a zoom change.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): add editor state and draggable slot overlay

Slots live in PDF points and are converted for display only, so zooming
cannot move them. Undo snapshots on gesture boundaries rather than per
keystroke."
```

---

### Task 16: Settle pipeline and download

**Files:**
- Create: `apps/web/src/features/editor/pipeline/useSettleRender.ts`
- Modify: `apps/web/src/features/editor/Editor.tsx`, `apps/web/src/features/editor/toolbar/Toolbar.tsx`

**Interfaces:**
- Consumes: `renderPdf` (Task 9), `loadFontBytes` (Task 12).
- Produces:
  ```ts
  export function useSettleRender(doc: EditorDocument | null, slots: Slot[]): {
    bytes: Uint8Array | null
    isRendering: boolean
  }
  ```

- [ ] **Step 1: Implement the debounce**

200ms after the last change to `slots`, call `renderPdf(doc, slots, fonts)` and store the result. Guard against out-of-order completion with a monotonically increasing request id — discard any result whose id is not the latest, or a slow render will overwrite a newer one.

- [ ] **Step 2: Render the returned bytes as the preview**

Feed `bytes` into `PageCanvas` in place of `doc.source` once it exists. This is the moment the preview becomes the real file.

- [ ] **Step 3: Hide overlay text once settled**

When a slot is not being actively edited and `bytes` is current, render only its border and handles — the text visible is the canvas's. Keep DOM text while typing.

- [ ] **Step 4: Wire download to the same array**

```tsx
function download() {
  if (!bytes) return
  const blob = new Blob([bytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'edited.pdf'
  a.click()
  URL.revokeObjectURL(url)
}
```

Do **not** call `renderPdf` here. Downloading anything other than the array already on screen breaks the invariant.

- [ ] **Step 5: Verify the invariant by hand**

Place a slot whose text wraps to three lines. Wait for settle. Download. Open the downloaded file in a separate viewer and compare line breaks and position against the screen. They must match exactly.

- [ ] **Step 6: Commit and push**

```bash
git add apps/web
git commit -m "feat(web): render the real PDF on settle and download those bytes

The preview becomes a render of the actual output file 200ms after the
last edit, and download saves that same array rather than regenerating,
so preview and download cannot diverge."
git push
```

---

### Task 17: Toolbar

**Files:**
- Create: `apps/web/src/features/editor/toolbar/Toolbar.tsx`

**Interfaces:**
- Consumes: `useEditorStore`, `FONT_LABELS`.
- Produces: a toolbar acting on the selected slot.

- [ ] **Step 1: Compose it from shadcn only**

`Select` for font (labels from `FONT_LABELS`) and size; `Popover` containing a small swatch grid for colour; `ToggleGroup` for alignment; `Button` with a trash icon for delete; `Separator` between groups; `Tooltip` on icon buttons. Disable everything when nothing is selected.

- [ ] **Step 2: Add zoom and page controls**

Zoom `−` / percentage / `+` plus fit-width; page back/forward with "N of M" when the document has more than one page.

- [ ] **Step 3: Verify no hand-written components crept in**

```bash
grep -rn "className=\"[^\"]*border[^\"]*rounded" apps/web/src/features/editor/toolbar/ || echo "clean"
```

Anything matching should be a shadcn component instead.

- [ ] **Step 4: Commit and push**

```bash
git add apps/web
git commit -m "feat(web): add editor toolbar

Font, size, colour, alignment, delete, zoom and page navigation, composed
entirely from shadcn primitives."
git push
```

---

### Task 18: IndexedDB persistence

**Files:**
- Create: `apps/web/src/lib/persistence/indexeddb.ts`
- Modify: `apps/web/src/features/editor/Editor.tsx`

**Interfaces:**
- Produces:
  ```ts
  export function saveSession(doc: EditorDocument, slots: Slot[]): Promise<void>
  export function loadSession(): Promise<{ doc: EditorDocument; slots: Slot[] } | null>
  export function clearSession(): Promise<void>
  ```

- [ ] **Step 1: Implement a single-record store**

One object store, one key. Persist the document bytes and slots; debounce writes to 1s.

- [ ] **Step 2: Degrade silently when storage is unavailable**

Wrap every call in try/catch. Private-browsing and quota failures must leave the editor fully functional — show a non-blocking toast once, never an error dialog.

- [ ] **Step 3: Restore on mount**

If a session exists, load it and skip the dropzone. Offer "Start over" in the toolbar, calling `clearSession`.

- [ ] **Step 4: Verify**

Place slots, reload the tab, confirm everything returns. Then test in a private window and confirm the editor still works.

- [ ] **Step 5: Commit and push**

```bash
git add apps/web
git commit -m "feat(web): persist the session to IndexedDB

Document bytes and slots survive a reload. Storage failures degrade to an
in-memory session rather than blocking the editor."
git push
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §2 invariant | 9, 10, 16 |
| §3 stack | 1, 11 |
| §4 architecture | 1, 11 |
| §5 data model | 7 |
| §6 coordinates | 4, 14 |
| §7 layout + kerning spike | 3, 5, 6 |
| §8 fonts | 2, 12 |
| §9 normalization | 7, 8, 13 |
| §10 editing flow | 14, 15, 16, 17, 18 |
| §11 UI | 11, 15, 17 |
| §12 error handling | 7, 13, 18 |
| §13 testing | 4, 6, 10 |
| §15 future server | 1 (core is framework-free) |

**Placeholder scan:** the only intentional blanks are the two measured numbers in Task 3 Step 5, which that step requires filling before its commit. Flagged explicitly there.

**Type consistency:** `EditorDocument`, `Slot`, `FontId`, `FontBytes`, `PositionedLine`, `Viewport`, `FontMetrics` are defined once and referenced with the same names throughout. `layoutText` takes `originX`/`originY` in every use. `renderPdf(doc, slots, fonts)` has the same signature in Tasks 9, 10 and 16.

**Known risk:** Task 3 may find that `pdf-lib` honours kerning in output. That flips `KERNING_APPLIED` to `true` and the overlay's `fontKerning` to `'normal'` — both already parameterised, so no restructuring follows.
