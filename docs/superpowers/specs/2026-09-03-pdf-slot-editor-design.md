# PDF Slot Editor — Design

**Date:** 2026-09-03
**Status:** Approved for planning

## 1. Purpose

A single-purpose web tool. The user uploads a document, places free-form text
anywhere on it, and downloads the result.

Three accepted inputs:

1. A born-digital PDF (real text objects, vector content)
2. An image-only PDF (a scan, or a photo exported to PDF)
3. An image file (PNG, JPEG, WebP, HEIC where the browser can decode it)

The reference product is Sejda's PDF editor, but only one of its features is in
scope: add a text slot and fill it in.

## 2. The invariant

**What the user sees in the preview must be exactly what the downloaded file
contains.** Same glyphs, same font, same size, same baseline, same colour, same
position, same line breaks.

This is the project's defining requirement. Every design decision below is
subordinate to it, and any future change that weakens it is a regression
regardless of what else it improves.

### How the invariant is achieved

Not by making two renderers agree. By removing the second renderer from the
answer:

1. **One layout engine decides line breaks.** A pure module measures text with
   `fontkit` and returns positioned lines. Both the on-screen overlay and the
   PDF writer consume that output. Neither the browser nor `pdf-lib` performs
   its own wrapping, so neither can disagree about it.

2. **The committed preview is the real file.** ~200ms after the last edit (or
   immediately on drag-end), the actual output PDF is generated and *those
   bytes* are rendered to the canvas with `pdf.js`. Download hands back the
   same byte array — it does not regenerate.

The guarantee is therefore structural: preview and download are not similar
artifacts produced by similar code, they are one byte array with two consumers.

### Where browser-rendered text still appears

Only inside the single slot being actively edited, and only between keystroke
and settle. Every other slot on the page is showing truth-rendered canvas
output. Once a slot settles, its DOM text is hidden and only selection handles
remain, so the user is looking at the real file.

## 3. Stack

| Concern | Choice | Licence |
|---|---|---|
| Framework | Next.js (App Router), TypeScript | — |
| Render PDF pages | `pdfjs-dist` | Apache-2.0 |
| Write PDFs, build PDF from image | `@cantoo/pdf-lib` | MIT |
| Font embedding + metrics | `@pdf-lib/fontkit` | MIT |
| UI components | shadcn/ui + Tailwind | MIT |

`@cantoo/pdf-lib` is a maintained fork of `pdf-lib`, whose last upstream release
was 2021. Same API.

**Rejected:** MuPDF.js — more capable, but AGPL, which would impose copyleft on
the whole codebase. PDFium/WASM — permissive but render-oriented, and we need
to write.

**Accepted limitation:** `pdf-lib` can add content to a page but cannot edit
text already in the document. This matches our scope exactly. Editing existing
text (Sejda's "click the text to change it") is a substantially harder problem
and explicitly out of scope.

### Runtime

Client-only. The uploaded file never leaves the browser: no upload wait, no
storage cost, no retention policy, and a genuine privacy claim for documents
that are often contracts or invoices.

Node 22 is required — npm 10.8.3 on Node 20.10 fails to resolve Next.js 16's
optional peer dependencies and exits without an error message.

## 4. Architecture

The core rule: **`packages/core` knows nothing about React or the DOM.**

```
packages/core/                    pure TypeScript, no UI dependencies
  document/
    types.ts                      Document, PageSize, Slot
    normalize.ts                  any input → Document
    image-to-pdf.ts               image bytes → single-page PDF
  layout/
    metrics.ts                    fontkit metrics, cached per font
    wrap.ts                       text + width → PositionedLine[]
  geometry/
    transform.ts                  screen px ⇄ PDF points
  render/
    pdf.ts                        Document + Slot[] → Uint8Array
  fonts/
    registry.ts                   the five bundled faces

apps/web/
  app/                            routes
  features/upload/                dropzone, validation
  features/editor/
    canvas/                       pdf.js page rendering, zoom
    overlay/                      slot boxes, drag, resize
    toolbar/                      font, size, colour, align, delete
    state/                        slots, selection, undo stack
  lib/persistence/                IndexedDB: file bytes + slots
  components/ui/                  shadcn
```

`core` being framework-free is what makes the "server-ready" requirement real.
A Hono route can later `import { renderPdf } from '@core'` and produce
byte-identical output with no change to the editor. It is also the module that
carries the invariant, so isolating it makes the invariant directly testable
without a browser.

## 5. Data model

```ts
type Document = {
  id: string
  source: Uint8Array          // always a PDF by this point
  pages: PageSize[]
}

type PageSize = { width: number; height: number }   // PDF points

type Slot = {
  id: string
  page: number                // 0-indexed
  x: number                   // PDF points, origin bottom-left
  y: number
  width: number               // wrap width; height is derived from layout
  text: string
  fontId: FontId
  size: number                // points
  color: { r: number; g: number; b: number }
  align: 'left' | 'center' | 'right'
  lineHeight: number          // multiplier, default 1.2
}
```

Slots are stored in **PDF coordinate space, never screen pixels.** Screen
position is derived by multiplying by the current zoom. One authoritative
number means a slot cannot drift because the viewport changed, and zoom,
re-render, and export all read from the same source.

## 6. Coordinate system

PDF's origin is bottom-left with Y increasing upward. The DOM's is top-left
with Y increasing downward. Every bug in an editor of this kind lives in that
flip, so all of it goes in `geometry/transform.ts` and nothing else is
permitted to do the arithmetic inline.

```
screen px → ÷ zoom → flip Y against page height → PDF points
```

Canvas rendering multiplies by `devicePixelRatio` so pages stay crisp on
high-DPI displays; that factor is part of the transform, not scattered through
the render code.

## 7. Text layout

`layout/wrap.ts` is the heart of the invariant.

**Input:** text, font id, size, box width, alignment, line height.
**Output:** `PositionedLine[]` — each with its string and its baseline origin
in PDF points.

Both consumers draw exactly these lines at exactly these origins. The browser
never wraps: the overlay renders one absolutely-positioned line per entry, with
`white-space: pre` so CSS cannot re-break it.

**Kerning must be settled empirically before the engine is written.** `pdf-lib`
measures custom fonts through fontkit, which applies GPOS kerning, but a PDF
viewer advances glyphs using the font's `Widths` array. Whether kerning
survives into the rendered output is a property of the library that must be
measured, not assumed. Whatever the answer, the browser overlay is configured
to match it (`font-kerning: none` and `font-variant-ligatures: none` if
`pdf-lib` drops kerning).

This is the first implementation task, and it is a spike: write text with
`pdf-lib`, render it back with `pdf.js`, and measure actual glyph positions
against what `wrap.ts` predicted. The layout engine is built against the
measured behaviour.

Note that even if the overlay and the output diverged slightly, the *download*
would still match the *committed preview*, because both come from the same
bytes. Getting kerning right removes a visible flicker at settle; it is not
what upholds the guarantee.

## 8. Fonts

Five bundled faces, shipped as TTFs and embedded with subsetting on export:

- Inter Regular / Bold (sans)
- Source Serif Regular / Bold (serif)
- JetBrains Mono (mono)

Each face is loaded once as an `ArrayBuffer` and used for three things: fontkit
metrics, `@font-face` for the overlay, and `pdf-lib` embedding. **One file, three
consumers** — the overlay cannot be rendering a different font from the one in
the output, because there is only one.

Embedded fonts are always subset into the output, so the file renders
identically on any machine regardless of what is installed.

Reusing fonts already embedded in the uploaded PDF was considered and rejected:
embedded fonts are usually subsetted to the glyphs the document already uses, so
typing a character the original didn't contain produces a missing glyph.

## 9. Input normalization

All three inputs converge on a `Document` before the editor sees anything, so
the editor has exactly one case to handle.

**Born-digital PDF** — parsed as-is. Page sizes read from the page tree.

**Image-only PDF** — indistinguishable from the above for our purposes.
`pdf.js` rasterizes whatever a page contains, and `pdf-lib` appends a new
content stream on top without needing to understand what is already there. No
OCR, because we never read existing text.

**Image file** — decoded via `createImageBitmap`, drawn to a canvas, re-encoded
as PNG or JPEG (the only formats `pdf-lib` embeds), then placed on a page whose
size is the standard page — A4 or US Letter — closest in aspect ratio, filling
it. The image is embedded at full resolution, so page size affects print scale
only, never quality.

Routing every image through a canvas also normalizes WebP and HEIC for free
wherever the browser can decode them, and gives one clean failure point for
formats it cannot.

## 10. The editing flow

| Step | Behaviour |
|---|---|
| **Upload** | `normalize()` produces a `Document`. All validation happens here. |
| **Render** | `pdf.js` draws page *N* to canvas at current zoom × `devicePixelRatio`. |
| **Place** | Click on the canvas → transform to PDF points → new `Slot`, focused. |
| **Type / drag** | Overlay updates live. `wrap.ts` recomputes on each change — pure arithmetic over cached metrics, microseconds. |
| **Settle** | 200ms after last keystroke, or immediately on drag-end: `renderPdf()` produces real bytes; `pdf.js` renders them off-screen; canvas swaps once painted. |
| **Download** | Saves the held bytes. No regeneration. |

The settle-swap renders off-screen and swaps only when the new canvas is
painted, so the page never blanks. Combined with the shared layout engine the
transition should be imperceptible.

**Also in scope:** multi-page navigation, zoom (fit-width, fit-page, ±),
slot selection and deletion, and undo/redo. Undo is a bounded stack of
snapshots of the `Slot[]` array — the array is small, so snapshots are simpler
and less bug-prone than inverse commands.

**Persistence:** IndexedDB holds the document bytes and its slots, so closing
the tab and returning restores the session. No server, so no share links and no
cross-device access; those are the features a backend would buy, and they are
not currently wanted.

## 11. UI

Vercel/Geist visual language: Geist Sans, near-black on white, one neutral gray
ramp, 1px hairline borders in place of shadows, 6px radii, colour reserved for
focus and selection. Dark mode from the same tokens.

Components come from shadcn/ui — `select` for the font picker, `popover` for
the colour picker, `toggle-group` for alignment, `button`, `dialog`, `tooltip`.
shadcn tokens are themed rather than components overridden.

**The one hand-rolled component is the slot overlay** — the draggable,
resizable text box. shadcn has no equivalent primitive because this is
canvas-editor interaction rather than a UI widget. The reason will be recorded
in a comment at that file, per project convention.

The chrome stays airy in keeping with the Geist aesthetic; the canvas sits on a
neutral gray workspace so the white page edges read clearly against it.

## 12. Error handling

Everything that can be detected is detected at upload, never mid-edit:

| Condition | Handling |
|---|---|
| Encrypted / password-protected PDF | `pdf-lib` refuses to modify these. Detect at load and say so plainly. |
| Corrupt or non-PDF bytes | Validate the header before parsing. |
| Image the browser cannot decode | Caught at `createImageBitmap`; reported as an unsupported format. |
| Very large file | Warn above a threshold rather than letting the tab exhaust memory. |
| IndexedDB unavailable or full | Editor works; persistence degrades silently with a non-blocking notice. |

## 13. Testing

**Layer 1 — layout engine.** Unit tests with golden cases: known string, font,
size and width produce exactly the expected line breaks and origins. No browser
needed. This is where wrapping regressions would surface.

**Layer 2 — geometry.** Property test round-tripping random points at random
zooms and page sizes: `toScreen(toPdf(p)) ≈ p` within floating-point tolerance.

**Layer 3 — the invariant.** An integration test asserting the byte array
handed to the preview renderer is identical to the array the download produces.
This makes the central guarantee executable rather than aspirational.

A visual regression check — render a known document with known slots and
compare against a stored raster — is worth adding once the editor stabilizes,
but golden images are brittle early on and are deferred.

## 14. Out of scope

Editing text already present in the document; forms; links; signatures;
inserting images into an existing PDF; OCR; accounts; share links; multi-user
editing; page manipulation (reorder, rotate, delete).

## 15. Future server extension

If share links or cross-device access are wanted later, the addition is
additive rather than a rewrite: a Hono API plus Postgres storing `documents`
and `slots` rows, with blob storage for file bytes. `packages/core` is already
framework-free, so the server imports the same `renderPdf` and produces
byte-identical output. Nothing in the editor changes.
