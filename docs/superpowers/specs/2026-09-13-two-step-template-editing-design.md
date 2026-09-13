# Two-step template editing — design

Date: 2026-09-13. Supersedes the single-step flow in
`2026-09-03-pdf-slot-editor-design.md` for everything about slot lifecycle and
persistence; the render/export invariant from that spec is unchanged.

## Goal

A user prepares a PDF once — placing and naming text slots where they belong
— and from then on, whenever that PDF is uploaded again, writes into those
slots without touching the layout. The layout and the written values are
saved per file. A backend (Hono + Postgres, per CLAUDE.md) will later hold
that data; until then it lives in the browser, behind the same interface.

## The two steps

| | Step 1 — **Layout** | Step 2 — **Write** |
|---|---|---|
| Purpose | Decide where text goes | Put text in |
| Place a slot | Click the page → name prompt → slot appears, selected, empty | Not allowed |
| Move / resize / style | Yes (drag, resize handle, toolbar) | No — slots are locked; **← Back** returns to step 1 |
| Type into a slot | Yes (placeholder / sample text, not saved as a value) | Yes — on the page or in the left form; the two are the same text |
| Delete a slot | Chip ✕ in the left panel (also removes it from the page) | No |
| Left panel | Chips: one per slot, name + ✕; click selects the slot on the page (and selecting a slot highlights its chip) | Form: one text field per slot, labelled by name, in page/reading order; **Save** at the bottom |
| Primary action | **Next →** saves the layout and enters step 2 | **Save** stores the typed values for this file; **Download** (toolbar) renders the PDF |
| Highlight | Selected slot: blue outline (today) | Every slot: light-blue fill + hairline border, so the user can see where to write; focused slot: blue outline |

Step 1's typed text is *not* a value — leaving step 1 clears any text typed
there, so slots always start empty in step 2. (Sample text in step 1 exists
only so the user can judge size and fit.)

Slots have a **name**, asked for at placement in step 1 (shadcn `Dialog` +
`Input`; Enter confirms, Esc/Cancel places nothing). *Implementation note: a
`Dialog`, not a click-anchored `Popover` — the installed Popover wrapper
exposes no anchor, and a modal needs no positioning code.* Names must be non-empty; duplicates are allowed
(the panel shows them as-is). Renaming: double-click a chip in step 1.

## Landing rules

On upload the file's **content hash** (SHA-256 of the bytes, via
`crypto.subtle.digest`) is computed.

- Hash known and its layout has at least one slot → load the layout and last
  saved values → **step 2**. (A saved layout with no slots has nothing to
  write into, so it lands in step 1 like a new file.)
- Hash unknown → new file → **step 1**, empty.
- On reload, the last opened file (its bytes are stored) reopens at the step it
  was in. **Start over** forgets only the *current session* (which file is
  open), never the saved layout — deleting a file's layout is not in scope.

A downloaded output has different bytes from the source, so re-uploading a
filled PDF would not match by content alone. To keep the link, `renderPdf`
stamps the source hash into the output's Info dictionary (`/PdfSlotSource`),
and upload checks that key before hashing. Both stay deterministic (the stamp
is derived from the input).

## Data model (`packages/core/src/document/template.ts`)

```ts
type FileId = string               // hex SHA-256 of the source PDF bytes

type TemplateSlot = {
  id: string                       // uuid, stable across sessions
  name: string
  page: number
  x: number; y: number; width: number   // displayed-page space, as today
  fontId: FontId; size: number; color: RGB; align: Align; lineHeight: number
  order: number                    // position in the panel; assigned on placement
}

type TemplateLayout = { fileId: FileId; slots: TemplateSlot[]; updatedAt: string }
type TemplateValues = { fileId: FileId; values: Record<string /* slot id */, string>; updatedAt: string }
type StoredFile   = { fileId: FileId; name: string; source: Uint8Array; pages: PageSize[]; createdAt: string }
```

`TemplateSlot` is a `Slot` minus `text` plus `name` and `order`. The editor
still works on `Slot[]` internally; `toSlots(layout, values)` and
`toLayout(slots, names)` convert at the boundary, so nothing in the overlay,
layout engine or renderer learns about names. `renderPdf` keeps taking
`Slot[]`.

## Persistence (`apps/web/src/lib/persistence/`)

```ts
interface TemplateStore {
  getFile(fileId): Promise<StoredFile | null>
  putFile(file: StoredFile): Promise<void>
  getLayout(fileId): Promise<TemplateLayout | null>
  putLayout(layout: TemplateLayout): Promise<void>
  getValues(fileId): Promise<TemplateValues | null>
  putValues(values: TemplateValues): Promise<void>
}
interface SessionStore {                     // "what is open right now"
  get(): Promise<{ fileId: FileId; step: 'layout' | 'write' } | null>
  put(session): Promise<void>
  clear(): Promise<void>
}
```

- `IndexedDbTemplateStore` implements `TemplateStore` now: one database,
  object stores `files`, `layouts`, `values`, each keyed by `fileId`
  (DB version 2; the old `session` store is dropped on upgrade — the
  single-session model is replaced, not migrated).
- `HttpTemplateStore` implements the same interface against the Hono API
  later. Nothing above the interface changes.
- Writes: `putLayout` on **Next →** (and on any step-1 change, debounced 1s,
  so a reload mid-layout loses nothing — same policy as today's session save);
  `putValues` on **Save** and debounced while typing in step 2 (Save is the
  explicit "I'm done", the debounce is the safety net).
- Storage unavailable degrades exactly as today: one warning toast, editing
  and download keep working, nothing persists.

## UI structure

```
<TemplateEditor>                          apps/web/src/features/template/
  ├─ <SlotPanel step=…>                   left column, 280px, full height
  │    step 1: <SlotChip>*  + Next →
  │    step 2: ← Back, <SlotField>* + Save
  └─ <Editor step=… locked=…>            existing editor, right column
       ├─ <Toolbar>                        step 2: only zoom, page nav, Download
       ├─ <PageCanvas>
       └─ <SlotOverlay locked highlighted named>*
```

- `Editor` gains `step`. In step 2 it passes `locked` to every `SlotOverlay`:
  no drag/resize handlers, no style controls, `cursor: text`; canvas clicks do
  nothing. The toolbar hides font/size/colour/align/delete.
- `SlotOverlay` gains `highlighted` (the light-blue fill) and `locked`.
- Text is one state: `SlotField` and the on-page textarea both call
  `store.updateSlot(id, { text })`; focusing either selects the slot.
- Name prompt is a `NamePopover` component used only in step 1.
- Chips and fields use shadcn (`Badge`-style chip with a ✕ `Button`, `Input`,
  `Label`, `Button`). Layout follows the reference: panel on a muted
  background, page on the right.

## Flow

1. Upload → hash → `getLayout` → step 1 or step 2 (see landing rules).
   `putFile` on first upload.
2. Step 1: place/name/move/style/delete; every change updates the store's
   `Slot[]` and (debounced) `putLayout`. Next → `putLayout` immediately,
   clear step-1 text, `SessionStore.put({ step: 'write' })`.
3. Step 2: type; debounced `putValues`. Save → `putValues` immediately
   + toast "Saved". Download → `render()` as today. ← Back →
   `SessionStore.put({ step: 'layout' })`; values are kept and restored when
   the user comes forward again (a slot deleted in step 1 drops its value).

Undo/redo (Ctrl+Z) stays per step: step 1 undoes layout changes, step 2
undoes typing.

## Error handling

- Name prompt cancelled → nothing placed.
- Hashing fails (no `crypto.subtle`, e.g. non-HTTPS origin) → treat as
  unknown file, warn once that layouts can't be remembered here.
- `TemplateStore` failures never block editing (same contract as today's
  `saveSession`).
- Unsupported characters gate Download exactly as today, in both steps.

## Testing

- `packages/core`: `template.test.ts` — `toSlots`/`toLayout` round-trip,
  order, dropped values for missing slots; `renderPdf` stamps
  `/PdfSlotSource` deterministically.
- `apps/web`:
  - `fileHash.test.ts` — known vector; falls back cleanly without
    `crypto.subtle`.
  - `IndexedDbTemplateStore.test.ts` (fake-indexeddb) — round-trips, upgrade
    from v1 drops `session`.
  - `TemplateEditor.test.ts` (real components, jsdom) — new file lands in
    step 1; placing asks for a name and creates a chip; chip ✕ removes the
    slot from the page; Next → persists and locks; typing in a field shows on
    the page and vice versa; Save persists values; ← Back unlocks; known file
    re-upload lands in step 2 with slots and values loaded.
  - `SlotOverlay.test.ts` — `locked` renders no drag/resize affordances.
- Verification mode (`renderOnCommit`) tests are unaffected: the renderer
  still consumes `Slot[]`.

## Out of scope

Deleting a saved layout; a file library/list; roles or auth; the backend
itself (only the interface it will implement); moving slots in step 2.
