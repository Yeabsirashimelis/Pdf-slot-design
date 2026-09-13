# Two-Step Template Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user lays out and names text slots on a PDF once (step 1), and every later upload of that PDF opens straight into writing into those locked slots (step 2), with layout and typed values saved per file.

**Architecture:** The existing `Editor` keeps working on `Slot[]`; a new `TemplateEditor` wraps it, owns the two-step state machine, the slot-name map, and persistence through a `TemplateStore` interface (IndexedDB now, the Hono API later). Files are identified by SHA-256 of their bytes; exports carry that id in the PDF Info dictionary so a downloaded copy still finds its layout.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, `@cantoo/pdf-lib`, shadcn/ui (base-ui), Vitest + Testing Library + fake-indexeddb.

**Spec:** `docs/superpowers/specs/2026-09-13-two-step-template-editing-design.md`

## Global Constraints

- Preview must equal download (CLAUDE.md). Nothing in this plan touches the render path except adding a metadata stamp; verification-mode tests (`renderOnCommit: true`) must stay green.
- Every UI element comes from shadcn/ui, installed with `npx shadcn@latest add <component>` — never hand-written. Hand-rolled markup only where shadcn has no component, with a comment saying why.
- Conventional Commits, atomic commits, **no trailers of any kind** in commit messages.
- Named exports. Geometry stays in `packages/core` and is unit-tested.
- Coordinates: `Slot.x/y/width` are in displayed-page space (see `packages/core/src/geometry/rotation.ts`); this plan does not change that.
- One deviation from the spec: the name prompt is a shadcn `Dialog`, not a click-anchored `Popover` — the installed Popover wrapper exposes no `anchor`, and a Dialog needs no positioning code.
- Run from `apps/web` unless a path says `packages/core`. Test command: `npx vitest run <file>`; typecheck `npx tsc --noEmit`; lint `npx eslint src test`.

---

## File map

**packages/core**
- Create `src/document/template.ts` — `TemplateSlot`, `TemplateLayout`, `TemplateValues`, `StoredFile`, `toSlots`, `toLayout`.
- Modify `src/render/pdf.ts` — stamp `/PdfSlotSource` = `doc.id`; add `readSourceStamp`.
- Modify `src/index.ts` — export the new module.
- Test `test/template.test.ts`, extend `test/render.test.ts`.

**apps/web**
- Create `src/lib/files/fileHash.ts` — `hashBytes(bytes): Promise<string | null>`.
- Create `src/lib/persistence/templateStore.ts` — `TemplateStore`, `SessionStore` interfaces + `OpenSession` type.
- Create `src/lib/persistence/indexedDbTemplateStore.ts` — both interfaces over IndexedDB v2 (`files`, `layouts`, `values`, `session` stores).
- Delete `src/lib/persistence/indexeddb.ts` and `test/indexeddb.test.ts`, `test/editorSessionPersistence.test.ts` (their behaviour moves to `TemplateEditor`).
- Modify `src/features/editor/state/useEditorStore.ts` — `addSlot` returns the new id; `replaceSlots(slots)`.
- Modify `src/features/editor/state/editorHistory.ts` — `applyReplace`.
- Modify `src/features/editor/Editor.tsx` — props `store?`, `locked?`, `onPlaceSlot?`; remove the session-save effects.
- Modify `src/features/editor/overlay/SlotOverlay.tsx` — `locked`, `highlighted`.
- Modify `src/features/editor/toolbar/Toolbar.tsx` — `locked` hides style controls.
- Create `src/features/template/NameSlotDialog.tsx`.
- Create `src/features/template/SlotPanel.tsx` (+ `SlotChip`, `SlotField` inside; split if it passes ~150 lines).
- Create `src/features/template/useTemplatePersistence.ts` — debounced layout/values writes.
- Create `src/features/template/TemplateEditor.tsx` — the two-step shell.
- Create `src/features/template/openFile.ts` — bytes → `{ doc, layout, values, step }`.
- Modify `src/features/upload/Dropzone.tsx` — emits `{ bytes, name }` (`onFile`), not an `EditorDocument`.
- Modify `src/app/page.tsx` — Dropzone → `openFile` → `TemplateEditor`; session restore; start over.
- Tests: `test/fileHash.test.ts`, `test/indexedDbTemplateStore.test.ts`, `test/NameSlotDialog.test.ts`, `test/SlotPanel.test.ts`, `test/TemplateEditor.test.ts`, `test/openFile.test.ts`; extend `test/SlotOverlay.test.ts`, `test/Toolbar.test.ts`, `test/useEditorStore.test.ts`, `test/editorHistory.test.ts`, `test/page.test.ts`.

---

### Task 1: Template data model (core)

**Files:**
- Create: `packages/core/src/document/template.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/template.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type FileId = string
  export type TemplateSlot = Omit<Slot, 'text'> & { name: string; order: number }
  export type TemplateLayout = { fileId: FileId; slots: TemplateSlot[]; updatedAt: string }
  export type TemplateValues = { fileId: FileId; values: Record<string, string>; updatedAt: string }
  export type StoredFile = { fileId: FileId; name: string; source: Uint8Array; pages: PageSize[]; createdAt: string }
  export function toSlots(layout: TemplateLayout, values?: TemplateValues | null): Slot[]
  export function toLayout(fileId: FileId, slots: Slot[], names: Record<string, string>, updatedAt: string): TemplateLayout
  export function toValues(fileId: FileId, slots: Slot[], updatedAt: string): TemplateValues
  ```

- [ ] **Step 1: Write the failing tests**

`packages/core/test/template.test.ts`:
```ts
import { expect, test } from 'vitest'
import { toLayout, toSlots, toValues, type TemplateLayout } from '../src/document/template.js'
import type { Slot } from '../src/document/types.js'

const slot = (over: Partial<Slot>): Slot => ({
  id: 'a', page: 0, x: 10, y: 700, width: 200, text: '', fontId: 'sans', size: 14,
  color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2, ...over,
})

test('toSlots orders by `order`, fills text from values, and leaves text empty when there is no value', () => {
  const layout: TemplateLayout = {
    fileId: 'f', updatedAt: 't',
    slots: [
      { ...slot({ id: 'b' }), text: undefined as never, name: 'Date', order: 1 },
      { ...slot({ id: 'a' }), text: undefined as never, name: 'CO#', order: 0 },
    ].map(({ text: _t, ...rest }) => rest),
  }
  const slots = toSlots(layout, { fileId: 'f', updatedAt: 't', values: { a: '001' } })
  expect(slots.map((s) => s.id)).toEqual(['a', 'b'])
  expect(slots[0]!.text).toBe('001')
  expect(slots[1]!.text).toBe('')
  expect('name' in slots[0]!).toBe(false)
})

test('toLayout assigns order from array position and drops text', () => {
  const layout = toLayout('f', [slot({ id: 'x', text: 'sample' }), slot({ id: 'y' })], { x: 'Name', y: 'Other' }, 't')
  expect(layout.slots.map((s) => [s.id, s.name, s.order])).toEqual([['x', 'Name', 0], ['y', 'Other', 1]])
  expect('text' in layout.slots[0]!).toBe(false)
  expect(layout.fileId).toBe('f')
})

test('toLayout falls back to "Slot N" for a slot with no name', () => {
  const layout = toLayout('f', [slot({ id: 'x' })], {}, 't')
  expect(layout.slots[0]!.name).toBe('Slot 1')
})

test('toValues keeps only non-empty text, keyed by slot id', () => {
  const values = toValues('f', [slot({ id: 'x', text: 'hi' }), slot({ id: 'y', text: '' })], 't')
  expect(values.values).toEqual({ x: 'hi' })
})

test('layout -> slots -> layout round-trips', () => {
  const original = toLayout('f', [slot({ id: 'x', x: 1, y: 2 }), slot({ id: 'y', size: 20 })], { x: 'A', y: 'B' }, 't')
  const again = toLayout('f', toSlots(original), { x: 'A', y: 'B' }, 't')
  expect(again).toEqual(original)
})
```

- [ ] **Step 2: Run to verify it fails**

Run (from `packages/core`): `npx vitest run test/template.test.ts`
Expected: FAIL — cannot find module `../src/document/template.js`.

- [ ] **Step 3: Implement**

`packages/core/src/document/template.ts`:
```ts
import type { PageSize, Slot } from './types'

/** Hex SHA-256 of the uploaded PDF's bytes: how a file is recognised on re-upload. */
export type FileId = string

/**
 * A slot as saved with a file's layout (step 1): everything about a `Slot`
 * except its text, plus the name shown in the side panel and its position
 * there. The editor itself never sees names -- it works on `Slot[]`, and
 * the conversions below run at the persistence boundary.
 */
export type TemplateSlot = Omit<Slot, 'text'> & { name: string; order: number }

export type TemplateLayout = { fileId: FileId; slots: TemplateSlot[]; updatedAt: string }

/** What was written into the slots (step 2), keyed by slot id. Empty text is not stored. */
export type TemplateValues = { fileId: FileId; values: Record<string, string>; updatedAt: string }

export type StoredFile = {
  fileId: FileId
  name: string
  source: Uint8Array
  pages: PageSize[]
  createdAt: string
}

export function toSlots(layout: TemplateLayout, values?: TemplateValues | null): Slot[] {
  return [...layout.slots]
    .sort((a, b) => a.order - b.order)
    .map(({ name: _name, order: _order, ...slot }) => ({ ...slot, text: values?.values[slot.id] ?? '' }))
}

export function toLayout(
  fileId: FileId, slots: Slot[], names: Record<string, string>, updatedAt: string,
): TemplateLayout {
  return {
    fileId,
    updatedAt,
    slots: slots.map(({ text: _text, ...slot }, index) => ({
      ...slot,
      name: names[slot.id] ?? `Slot ${index + 1}`,
      order: index,
    })),
  }
}

export function toValues(fileId: FileId, slots: Slot[], updatedAt: string): TemplateValues {
  const values: Record<string, string> = {}
  for (const slot of slots) if (slot.text !== '') values[slot.id] = slot.text
  return { fileId, values, updatedAt }
}
```

Add to `packages/core/src/index.ts` after `./document/types`: `export * from './document/template'`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/template.test.ts && npx tsc --noEmit`
Expected: 5 passed, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/document/template.ts packages/core/src/index.ts packages/core/test/template.test.ts
git commit -m "feat(core): template layout/values model and Slot conversions"
```

---

### Task 2: Source stamp in exported PDFs (core)

**Files:**
- Modify: `packages/core/src/render/pdf.ts`
- Test: `packages/core/test/render.test.ts`

**Interfaces:**
- Produces: `export const SOURCE_STAMP_KEY = 'PdfSlotSource'`; `export async function readSourceStamp(bytes: Uint8Array): Promise<string | null>`.
- `renderPdf(doc, …)` writes `doc.id` under that key in the Info dictionary; `renderPdfIncremental` preserves it.

- [ ] **Step 1: Write the failing tests** (append to `packages/core/test/render.test.ts`)

```ts
import { readSourceStamp, renderPdfIncremental } from '../src/render/pdf.js'
// (merge into the existing import line from '../src/render/pdf.js')

test('the export carries its source id in the Info dictionary, so a downloaded copy can find its layout', async () => {
  const doc = await blankDoc()
  const out = await renderPdf({ ...doc, id: 'abc123' }, [slot()], fonts)
  expect(await readSourceStamp(out)).toBe('abc123')
  // Still deterministic with the stamp in place.
  const again = await renderPdf({ ...doc, id: 'abc123' }, [slot()], fonts)
  expect(Buffer.from(out).equals(Buffer.from(again))).toBe(true)
})

test('an increment keeps the source stamp', async () => {
  const doc = await blankDoc()
  const first = await renderPdf({ ...doc, id: 'abc123' }, [slot()], fonts)
  const second = await renderPdfIncremental(first, [slot({ text: 'Beta' })], fonts)
  expect(await readSourceStamp(second)).toBe('abc123')
})

test('a PDF that was never exported by this tool has no stamp', async () => {
  const doc = await blankDoc()
  expect(await readSourceStamp(doc.source)).toBeNull()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/render.test.ts`
Expected: FAIL — `readSourceStamp` is not exported.

- [ ] **Step 3: Implement**

In `packages/core/src/render/pdf.ts`:

Add to the pdf-lib import: `PDFDict, PDFHexString, PDFString`.

Add after `SLOT_STREAM_MARKER`:
```ts
/**
 * Info-dictionary key carrying the id (content hash) of the *source* PDF an
 * export was made from. A downloaded copy has different bytes from its
 * source, so re-uploading it would not match by content; this is what
 * still lets it find its saved layout. Private Info keys are legal (ISO
 * 32000-1 §14.3.3) and ignored by viewers.
 */
export const SOURCE_STAMP_KEY = 'PdfSlotSource'

/** The source id an export was stamped with, or null for any other PDF. */
export async function readSourceStamp(bytes: Uint8Array): Promise<string | null> {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
  const info = pdf.context.lookup(pdf.context.trailerInfo.Info)
  if (!(info instanceof PDFDict)) return null
  const value = info.lookup(PDFName.of(SOURCE_STAMP_KEY))
  if (value instanceof PDFHexString || value instanceof PDFString) return value.decodeText()
  return null
}
```

In `renderPdf`, before `return finish(...)`:
```ts
  stampSource(pdf, doc.id)
```
and add the helper:
```ts
function stampSource(pdf: PDFDocument, sourceId: string): void {
  // setCreationDate (in finish) would create the Info dict if missing; do it
  // here so the stamp lands in the same dict.
  pdf.setCreationDate(EPOCH)
  const info = pdf.context.lookup(pdf.context.trailerInfo.Info)
  if (info instanceof PDFDict) info.set(PDFName.of(SOURCE_STAMP_KEY), PDFHexString.fromText(sourceId))
}
```
`renderPdfIncremental` needs no change: `finish` rewrites the Info dict with its existing entries, so the stamp is carried into the increment.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all core tests pass (including `invariant.test.ts`'s byte-identity test).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/render/pdf.ts packages/core/test/render.test.ts
git commit -m "feat(core): stamp the source id into exports so a downloaded copy finds its layout"
```

---

### Task 3: File hashing (web)

**Files:**
- Create: `apps/web/src/lib/files/fileHash.ts`
- Test: `apps/web/test/fileHash.test.ts`

**Interfaces:**
- Produces: `export async function hashBytes(bytes: Uint8Array): Promise<string | null>` — lowercase hex SHA-256, or `null` when `crypto.subtle` is unavailable.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hashBytes } from '@/lib/files/fileHash'

describe('hashBytes', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is SHA-256 hex (known vector for "abc")', async () => {
    expect(await hashBytes(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('returns null when SubtleCrypto is unavailable (plain-http origins)', async () => {
    vi.stubGlobal('crypto', { ...globalThis.crypto, subtle: undefined })
    expect(await hashBytes(new Uint8Array([1]))).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/fileHash.test.ts` — FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * SHA-256 of the uploaded bytes, as lowercase hex: the file's identity for
 * "re-upload the same PDF, get the same layout". `null` (rather than a
 * throw) when SubtleCrypto is missing -- it is only exposed on secure
 * origins, so a plain-http dev server on a LAN address has none -- and the
 * caller treats the file as new.
 */
export async function hashBytes(bytes: Uint8Array): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return null
  const digest = await subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run test/fileHash.test.ts`: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/files/fileHash.ts apps/web/test/fileHash.test.ts
git commit -m "feat(web): content hash for file identity"
```

---

### Task 4: TemplateStore + SessionStore interfaces and the IndexedDB implementation

**Files:**
- Create: `apps/web/src/lib/persistence/templateStore.ts`
- Create: `apps/web/src/lib/persistence/indexedDbTemplateStore.ts`
- Test: `apps/web/test/indexedDbTemplateStore.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Step = 'layout' | 'write'
  export type OpenSession = { fileId: FileId; step: Step }
  export interface TemplateStore {
    getFile(fileId: FileId): Promise<StoredFile | null>
    putFile(file: StoredFile): Promise<void>
    getLayout(fileId: FileId): Promise<TemplateLayout | null>
    putLayout(layout: TemplateLayout): Promise<void>
    getValues(fileId: FileId): Promise<TemplateValues | null>
    putValues(values: TemplateValues): Promise<void>
  }
  export interface SessionStore {
    get(): Promise<OpenSession | null>
    put(session: OpenSession): Promise<void>
    clear(): Promise<void>
  }
  export class IndexedDbTemplateStore implements TemplateStore, SessionStore { … }
  export const templateStore: IndexedDbTemplateStore   // app-wide instance
  ```
- Every method resolves (never rejects) when storage is unavailable: reads give `null`, writes warn once via the existing toast copy.

- [ ] **Step 1: Write the failing tests**

```ts
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoredFile, TemplateLayout, TemplateValues } from '@pdf-slot/core'

const file: StoredFile = {
  fileId: 'f1', name: 'form.pdf', source: new Uint8Array([1, 2, 3]),
  pages: [{ width: 612, height: 792 }], createdAt: '2026-09-13T00:00:00.000Z',
}
const layout: TemplateLayout = {
  fileId: 'f1', updatedAt: '2026-09-13T00:00:00.000Z',
  slots: [{ id: 's1', name: 'CO#', order: 0, page: 0, x: 1, y: 2, width: 200, fontId: 'sans', size: 14, color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2 }],
}
const values: TemplateValues = { fileId: 'f1', updatedAt: '2026-09-13T00:00:00.000Z', values: { s1: '001' } }

describe('IndexedDbTemplateStore', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    vi.stubGlobal('IDBKeyRange', IDBKeyRange)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('round-trips file, layout and values by fileId, and reads null for unknown ids', async () => {
    const { IndexedDbTemplateStore } = await import('../src/lib/persistence/indexedDbTemplateStore')
    const store = new IndexedDbTemplateStore()
    expect(await store.getFile('f1')).toBeNull()
    await store.putFile(file)
    await store.putLayout(layout)
    await store.putValues(values)
    expect(Array.from((await store.getFile('f1'))!.source)).toEqual([1, 2, 3])
    expect(await store.getLayout('f1')).toEqual(layout)
    expect(await store.getValues('f1')).toEqual(values)
    expect(await store.getLayout('nope')).toBeNull()
  })

  it('a later put replaces the earlier one', async () => {
    const { IndexedDbTemplateStore } = await import('../src/lib/persistence/indexedDbTemplateStore')
    const store = new IndexedDbTemplateStore()
    await store.putValues(values)
    await store.putValues({ ...values, values: { s1: '002' } })
    expect((await store.getValues('f1'))!.values).toEqual({ s1: '002' })
  })

  it('remembers and clears the open session', async () => {
    const { IndexedDbTemplateStore } = await import('../src/lib/persistence/indexedDbTemplateStore')
    const store = new IndexedDbTemplateStore()
    expect(await store.get()).toBeNull()
    await store.put({ fileId: 'f1', step: 'write' })
    expect(await store.get()).toEqual({ fileId: 'f1', step: 'write' })
    await store.clear()
    expect(await store.get()).toBeNull()
  })

  it('upgrading from the v1 database drops the old single-session store', async () => {
    // Create a v1 database the way the previous release did.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('pdf-slot-editor', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('session')
      req.onsuccess = () => { req.result.close(); resolve() }
      req.onerror = () => reject(req.error)
    })
    const { IndexedDbTemplateStore } = await import('../src/lib/persistence/indexedDbTemplateStore')
    const store = new IndexedDbTemplateStore()
    await store.putLayout(layout)
    const names = await new Promise<string[]>((resolve, reject) => {
      const req = indexedDB.open('pdf-slot-editor')
      req.onsuccess = () => { resolve(Array.from(req.result.objectStoreNames)); req.result.close() }
      req.onerror = () => reject(req.error)
    })
    expect(names.sort()).toEqual(['files', 'layouts', 'session', 'values'])
    expect(await store.get()).toBeNull()
  })

  it('never rejects when IndexedDB is unavailable; reads are null and one warning is shown', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const sonner = await import('sonner')
    const warn = vi.spyOn(sonner.toast, 'warning')
    const { IndexedDbTemplateStore } = await import('../src/lib/persistence/indexedDbTemplateStore')
    const store = new IndexedDbTemplateStore()
    await expect(store.putLayout(layout)).resolves.toBeUndefined()
    await expect(store.putValues(values)).resolves.toBeUndefined()
    expect(await store.getLayout('f1')).toBeNull()
    expect(await store.get()).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run test/indexedDbTemplateStore.test.ts`: FAIL, module not found.

- [ ] **Step 3: Implement**

`apps/web/src/lib/persistence/templateStore.ts`:
```ts
import type { FileId, StoredFile, TemplateLayout, TemplateValues } from '@pdf-slot/core'

export type Step = 'layout' | 'write'
export type OpenSession = { fileId: FileId; step: Step }

/**
 * Per-file persistence for the two-step editor. IndexedDB implements it
 * today (indexedDbTemplateStore.ts); the Hono backend will implement the
 * same six methods over HTTP. Nothing above this interface knows which.
 *
 * Contract: methods never reject. Storage being unavailable is normal
 * (private browsing, quota, policy) and must degrade to "nothing is
 * remembered", not a broken editor -- reads return null, writes are dropped.
 */
export interface TemplateStore {
  getFile(fileId: FileId): Promise<StoredFile | null>
  putFile(file: StoredFile): Promise<void>
  getLayout(fileId: FileId): Promise<TemplateLayout | null>
  putLayout(layout: TemplateLayout): Promise<void>
  getValues(fileId: FileId): Promise<TemplateValues | null>
  putValues(values: TemplateValues): Promise<void>
}

/** What is open right now -- so a reload lands the user back where they were. */
export interface SessionStore {
  get(): Promise<OpenSession | null>
  put(session: OpenSession): Promise<void>
  clear(): Promise<void>
}
```

`apps/web/src/lib/persistence/indexedDbTemplateStore.ts`:
```ts
import { toast } from 'sonner'
import type { FileId, StoredFile, TemplateLayout, TemplateValues } from '@pdf-slot/core'
import type { OpenSession, SessionStore, TemplateStore } from './templateStore'

const DB_NAME = 'pdf-slot-editor'
// v1 held a single `session` record (document bytes + slots). v2 keys
// everything by file id; the v1 record is dropped, not migrated -- the
// single-session model it served is gone.
const DB_VERSION = 2
const STORES = ['files', 'layouts', 'values', 'session'] as const
type StoreName = (typeof STORES)[number]
const SESSION_KEY = 'current'

let hasWarned = false
function warnUnavailable(): void {
  if (hasWarned) return
  hasWarned = true
  toast.warning("Your changes won't be saved between visits", {
    description:
      'Storage is unavailable in this browser (private browsing, or storage is blocked). You can still edit and download normally.',
  })
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser'))
      return
    }
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      for (const name of Array.from(db.objectStoreNames)) {
        if (!(STORES as readonly string[]).includes(name)) db.deleteObjectStore(name)
      }
      for (const name of STORES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'))
    request.onblocked = () => reject(new Error('IndexedDB open request was blocked'))
  })
}

async function read<T>(store: StoreName, key: string): Promise<T | null> {
  try {
    const db = await openDatabase()
    try {
      return await new Promise<T | null>((resolve, reject) => {
        const tx = db.transaction(store, 'readonly')
        const req = tx.objectStore(store).get(key)
        req.onsuccess = () => resolve((req.result as T | undefined) ?? null)
        req.onerror = () => reject(req.error ?? new Error('Failed to read'))
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
      })
    } finally {
      db.close()
    }
  } catch (err) {
    console.error(`Failed to read ${store}/${key}`, err)
    return null
  }
}

async function write(store: StoreName, key: string, value: unknown | undefined): Promise<void> {
  try {
    const db = await openDatabase()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite')
        if (value === undefined) tx.objectStore(store).delete(key)
        else tx.objectStore(store).put(value, key)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
      })
    } finally {
      db.close()
    }
  } catch (err) {
    warnUnavailable()
    console.error(`Failed to write ${store}/${key}`, err)
  }
}

export class IndexedDbTemplateStore implements TemplateStore, SessionStore {
  getFile(fileId: FileId): Promise<StoredFile | null> {
    return read<StoredFile>('files', fileId)
  }
  putFile(file: StoredFile): Promise<void> {
    // Copy the bytes: IDB structured-clones anyway, but never hand a buffer
    // that pdf.js may later detach to anything that outlives this call.
    return write('files', file.fileId, { ...file, source: file.source.slice() })
  }
  getLayout(fileId: FileId): Promise<TemplateLayout | null> {
    return read<TemplateLayout>('layouts', fileId)
  }
  putLayout(layout: TemplateLayout): Promise<void> {
    return write('layouts', layout.fileId, layout)
  }
  getValues(fileId: FileId): Promise<TemplateValues | null> {
    return read<TemplateValues>('values', fileId)
  }
  putValues(values: TemplateValues): Promise<void> {
    return write('values', values.fileId, values)
  }
  get(): Promise<OpenSession | null> {
    return read<OpenSession>('session', SESSION_KEY)
  }
  put(session: OpenSession): Promise<void> {
    return write('session', SESSION_KEY, session)
  }
  clear(): Promise<void> {
    return write('session', SESSION_KEY, undefined)
  }
}

/** The app-wide instance; page.tsx and TemplateEditor take it as a prop so tests can pass their own. */
export const templateStore = new IndexedDbTemplateStore()
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run test/indexedDbTemplateStore.test.ts && npx tsc --noEmit`: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/persistence/templateStore.ts apps/web/src/lib/persistence/indexedDbTemplateStore.ts apps/web/test/indexedDbTemplateStore.test.ts
git commit -m "feat(web): per-file TemplateStore/SessionStore interfaces with an IndexedDB implementation"
```

---

### Task 5: Store plumbing — `addSlot` returns the id; `replaceSlots`

**Files:**
- Modify: `apps/web/src/features/editor/state/editorHistory.ts`
- Modify: `apps/web/src/features/editor/state/useEditorStore.ts`
- Test: `apps/web/test/editorHistory.test.ts`, `apps/web/test/useEditorStore.test.ts`

**Interfaces:**
- Produces: `addSlot(atPdf, page): string` (the new slot's id); `replaceSlots(slots: Slot[]): void` (sets `present` and clears history — used when entering a step); `applyReplace(state, slots): HistoryState`.

- [ ] **Step 1: Write the failing tests**

Append to `test/editorHistory.test.ts`:
```ts
import { applyReplace } from '../src/features/editor/state/editorHistory'
// (merge into the existing import)

it('applyReplace swaps the present list and forgets all history', () => {
  let state = createHistory([makeSlot('a')])
  state = applyAddSlot(state, makeSlot('b'))
  state = applyReplace(state, [makeSlot('z')])
  expect(state.present.map((s) => s.id)).toEqual(['z'])
  expect(state.past).toEqual([])
  expect(state.future).toEqual([])
  expect(state.pendingBefore).toBeNull()
})
```
(Use whatever slot factory `editorHistory.test.ts` already defines; if it is named differently, use that name.)

Append to `test/useEditorStore.test.ts`:
```ts
it('addSlot returns the id of the slot it created', () => {
  const { result } = renderHook(() => useEditorStore())
  let id = ''
  act(() => {
    id = result.current.addSlot({ x: 10, y: 700 }, 0)
  })
  expect(id).toBe(result.current.slots[0]!.id)
  expect(result.current.selectedId).toBe(id)
})

it('replaceSlots installs a new list, clears selection and undo history', () => {
  const { result } = renderHook(() => useEditorStore())
  act(() => { result.current.addSlot({ x: 10, y: 700 }, 0) })
  const fresh = { ...result.current.slots[0]!, id: 'fresh', text: 'hello' }
  act(() => { result.current.replaceSlots([fresh]) })
  expect(result.current.slots).toEqual([fresh])
  expect(result.current.selectedId).toBeNull()
  expect(result.current.canUndo).toBe(false)
})
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run test/editorHistory.test.ts test/useEditorStore.test.ts`: FAIL (`applyReplace`/`replaceSlots` undefined; `addSlot` returns undefined).

- [ ] **Step 3: Implement**

`editorHistory.ts`, add:
```ts
/**
 * Install a whole new slot list and forget the history: entering a step
 * (layout <-> write) is a boundary undo must not cross -- Ctrl+Z in step 2
 * undoes typing, never a layout change made in step 1.
 */
export function applyReplace(_state: HistoryState, slots: Slot[]): HistoryState {
  return createHistory(slots)
}
```

`useEditorStore.ts`:
- Change the type: `addSlot(atPdf: Point, page: number): string` and add `replaceSlots(slots: Slot[]): void`.
- `addSlot` ends with `return slot.id`.
- Add:
```ts
  const replaceSlots = useCallback((slots: Slot[]) => {
    setHistory((state) => applyReplace(state, slots))
    setSelectedId(null)
  }, [])
```
and include `replaceSlots` in the returned object; import `applyReplace`.

- [ ] **Step 4: Run to verify they pass** — `npx vitest run && npx tsc --noEmit`: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/editor/state apps/web/test/editorHistory.test.ts apps/web/test/useEditorStore.test.ts
git commit -m "feat(web): addSlot returns the new id; replaceSlots resets the list and history"
```

---

### Task 6: `SlotOverlay` — `locked` and `highlighted`

**Files:**
- Modify: `apps/web/src/features/editor/overlay/SlotOverlay.tsx`
- Test: `apps/web/test/SlotOverlay.test.ts`

**Interfaces:**
- Produces props `locked?: boolean` (no drag/resize; cursor text; canvas-style pointer handlers off) and `highlighted?: boolean` (light-blue fill + hairline border).

- [ ] **Step 1: Write the failing tests** (append to the `describe` in `test/SlotOverlay.test.ts`; extend `renderOverlay` to accept extra props: `renderOverlay(selected: boolean, extra: Partial<Parameters<typeof SlotOverlay>[0]> = {})` and spread `...extra` into the props)

```ts
  it('locked: no resize handle even when selected, text cursor, and dragging does nothing', () => {
    const onChange = vi.fn()
    const { box } = renderOverlay(true, { locked: true, onChange })
    expect(box.style.cursor).toBe('text')
    // The resize handle is the only child div with cursor ew-resize.
    expect(Array.from(box.querySelectorAll('div')).some((d) => d.style.cursor === 'ew-resize')).toBe(false)
    fireEvent.pointerDown(box, { pointerId: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(box, { pointerId: 1, clientX: 40, clientY: 0 })
    fireEvent.pointerUp(box, { pointerId: 1 })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('highlighted: shows a fill and hairline so the user can see where to write', () => {
    const { box } = renderOverlay(false, { highlighted: true })
    expect(box.style.backgroundColor).not.toBe('')
    expect(box.style.boxShadow).toContain('inset')
  })
```
Add `fireEvent` to the Testing Library import. In jsdom `setPointerCapture` is missing: add at the top of the file `HTMLElement.prototype.setPointerCapture ??= () => {}`.

- [ ] **Step 2: Run to verify they fail** — `npx vitest run test/SlotOverlay.test.ts`: the two new tests FAIL.

- [ ] **Step 3: Implement**

In `SlotOverlay.tsx`:
- Add to props: `locked?: boolean` and `highlighted?: boolean` (default `false`), with doc comments:
  ```ts
  /** Step 2: position, size and style are fixed -- only the text can change. */
  locked?: boolean
  /** Step 2: every slot is tinted so the user can see where to write. */
  highlighted?: boolean
  ```
- At the top of `handleBodyPointerDown` and `handleResizePointerDown`: `if (locked) return`.
- Root div style: `cursor: locked ? 'text' : 'move'`; add
  ```ts
  backgroundColor: highlighted ? 'rgba(37, 99, 235, 0.08)' : undefined,
  boxShadow: highlighted ? 'inset 0 0 0 1px rgba(37, 99, 235, 0.35)' : undefined,
  ```
  (a box-shadow, like the outline, takes no part in layout — see the comment on `outline` there; do not use `border`.)
- Render the resize handle only when `selected && !locked`.

- [ ] **Step 4: Run to verify they pass** — `npx vitest run test/SlotOverlay.test.ts && npx eslint src/features/editor/overlay`: green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/editor/overlay/SlotOverlay.tsx apps/web/test/SlotOverlay.test.ts
git commit -m "feat(web): locked and highlighted slot overlays for the write step"
```

---

### Task 7: `Toolbar` — `locked` hides style controls

**Files:**
- Modify: `apps/web/src/features/editor/toolbar/Toolbar.tsx`
- Test: `apps/web/test/Toolbar.test.ts`

**Interfaces:**
- Produces prop `locked?: boolean`: when true, font/size/colour/align/delete are not rendered; zoom, page navigation, Download and Start over remain.

- [ ] **Step 1: Write the failing test** (new `describe` in `test/Toolbar.test.ts`)

```ts
describe('Toolbar locked (write step)', () => {
  afterEach(() => cleanup())

  it('renders no style or delete controls, but keeps zoom, pages and download', () => {
    render(createElement(Toolbar, baseProps({ locked: true, pageCount: 3 })))
    for (const id of ['font-select-trigger', 'size-select-trigger', 'color-trigger', 'align-toggle-group', 'delete-button']) {
      expect(screen.queryByTestId(id)).toBeNull()
    }
    expect(screen.getByTestId('zoom-controls')).toBeTruthy()
    expect(screen.getByTestId('page-controls')).toBeTruthy()
    expect(screen.getByTestId('download-button')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run test/Toolbar.test.ts`: FAIL (controls still present).

- [ ] **Step 3: Implement**

In `Toolbar.tsx`: add `locked?: boolean` to `ToolbarProps` with the doc comment `/** Step 2: slots are locked, so the per-slot style controls are hidden rather than merely disabled. */`, destructure `locked = false`, and wrap everything from the font `Select` through the delete `Tooltip` **and the `Separator` that follows it** in `{!locked && (<> … </>)}`.

- [ ] **Step 4: Run to verify it passes** — `npx vitest run test/Toolbar.test.ts && npx eslint src/features/editor/toolbar`: green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/editor/toolbar/Toolbar.tsx apps/web/test/Toolbar.test.ts
git commit -m "feat(web): toolbar hides style controls when slots are locked"
```

---

### Task 8: `Editor` — external store, `locked`, `onPlaceSlot`; persistence lifted out

**Files:**
- Modify: `apps/web/src/features/editor/Editor.tsx`
- Delete: `apps/web/src/lib/persistence/indexeddb.ts`, `apps/web/test/indexeddb.test.ts`, `apps/web/test/editorSessionPersistence.test.ts`
- Modify: `apps/web/src/app/page.tsx` (temporarily: stop importing the deleted module — Task 13 rewires it fully)
- Test: `apps/web/test/Editor.test.ts`

**Interfaces:**
- Produces Editor props:
  ```ts
  store?: EditorStore          // when given, Editor uses it instead of creating its own
  locked?: boolean             // forwarded to every SlotOverlay and the Toolbar; canvas clicks ignored
  highlighted?: boolean        // forwarded to every SlotOverlay
  onPlaceSlot?(atPdf: Point, page: number): void   // when given, a canvas click calls this instead of store.addSlot
  ```
  `initialSlots` remains for the no-`store` case. The debounced IndexedDB session save and its flush effects are removed from Editor.
- Consumes: `EditorStore` from Task 5.

- [ ] **Step 1: Write the failing tests** (append to the `describe` in `test/Editor.test.ts`)

```ts
  it('with onPlaceSlot, a canvas click asks the parent instead of adding a slot', async () => {
    const { Editor } = await import('../src/features/editor/Editor')
    const onPlaceSlot = vi.fn()
    const { container } = render(createElement(Editor, { doc: makeDoc(), onPlaceSlot }))
    const canvas = await waitFor(() => container.querySelector('canvas') as HTMLCanvasElement)
    fireEvent.click(canvas, { clientX: 50, clientY: 50 })
    expect(onPlaceSlot).toHaveBeenCalledTimes(1)
    expect(onPlaceSlot.mock.calls[0]![1]).toBe(0)
    expect(container.querySelector('[data-slot-id]')).toBeNull()
  })

  it('locked: canvas clicks place nothing and slots render locked', async () => {
    const { Editor } = await import('../src/features/editor/Editor')
    const { useEditorStore } = await import('../src/features/editor/state/useEditorStore')
    function Harness() {
      const store = useEditorStore([{
        id: 's1', page: 0, x: 50, y: 700, width: 200, text: '', fontId: 'sans', size: 14,
        color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2,
      }])
      return createElement(Editor, { doc: makeDoc(), store, locked: true, highlighted: true })
    }
    const { container } = render(createElement(Harness))
    const box = await waitFor(() => container.querySelector('[data-slot-id="s1"]') as HTMLElement)
    expect(box.style.cursor).toBe('text')
    expect(box.style.backgroundColor).not.toBe('')
    const canvas = container.querySelector('canvas') as HTMLCanvasElement
    fireEvent.click(canvas, { clientX: 5, clientY: 5 })
    expect(container.querySelectorAll('[data-slot-id]').length).toBe(1)
    expect(container.querySelector('[data-testid="font-select-trigger"]')).toBeNull()
  })
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run test/Editor.test.ts`: the two new tests FAIL.

- [ ] **Step 3: Implement**

In `Editor.tsx`:
1. Props: add `store?: EditorStore`, `locked?: boolean`, `highlighted?: boolean`, `onPlaceSlot?(atPdf: Point, page: number): void`. Import `type Point` from `@pdf-slot/core` and `type EditorStore` from `./state/useEditorStore`.
2. `const ownStore = useEditorStore(initialSlots); const store = externalStore ?? ownStore` (destructure the prop as `store: externalStore`). Hooks are still called unconditionally.
3. `handleCanvasClick`:
   ```ts
   const handleCanvasClick = (screen: LogicalPoint) => {
     if (locked) return
     const atPdf = toPdfPoint(screen, viewport)
     if (onPlaceSlot) {
       onPlaceSlot(atPdf, pageIndex)
       return
     }
     setAwaitingFocusAfterClick(true)
     store.addSlot(atPdf, pageIndex)
   }
   ```
4. Pass `locked={locked}` to `Toolbar`; pass `locked={locked}` and `highlighted={highlighted}` to every `SlotOverlay`.
5. Remove: the `saveSession` import, `SAVE_DEBOUNCE_MS`, `pendingSaveRef`, both persistence `useEffect`s, and `handleStartOver`'s `pendingSaveRef.current = null` line (keep `handleStartOver` calling `onStartOver`). Update the file's doc comments accordingly (persistence now lives in `features/template`).
6. Delete `src/lib/persistence/indexeddb.ts`, `test/indexeddb.test.ts`, `test/editorSessionPersistence.test.ts`. In `src/app/page.tsx`, remove the `loadSession`/`clearSession` import and the restore effect for now: render `<Dropzone onDocument={setDoc}/>` when `doc` is null and `<Editor doc={doc} onStartOver={() => setDoc(null)}/>` otherwise (Task 13 replaces this file).

- [ ] **Step 4: Run to verify** — `npx vitest run && npx tsc --noEmit && npx eslint src test`: all green (the deleted suites are gone; `page.test.ts` may need its `loadSession` mock removed — do so).

- [ ] **Step 5: Commit**

```bash
git add -A apps/web/src apps/web/test
git commit -m "refactor(web): Editor takes an external store, locked mode and a placement hook; session persistence lifted out"
```

---

### Task 9: `NameSlotDialog`

**Files:**
- Create: `apps/web/src/features/template/NameSlotDialog.tsx`
- Test: `apps/web/test/NameSlotDialog.test.ts`
- Install: `npx shadcn@latest add label` (from `apps/web`)

**Interfaces:**
- Produces:
  ```ts
  export function NameSlotDialog(props: {
    open: boolean
    initialName?: string          // set when renaming
    onSubmit(name: string): void  // trimmed, non-empty
    onCancel(): void
  })
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NameSlotDialog } from '@/features/template/NameSlotDialog'

describe('NameSlotDialog', () => {
  afterEach(() => cleanup())

  it('submits the trimmed name on Enter and via the Add button; refuses empty', () => {
    const onSubmit = vi.fn()
    render(createElement(NameSlotDialog, { open: true, onSubmit, onCancel: vi.fn() }))
    const input = screen.getByTestId('slot-name-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.click(screen.getByTestId('slot-name-submit'))
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '  CO#  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith('CO#')
  })

  it('cancels via the Cancel button', () => {
    const onCancel = vi.fn()
    render(createElement(NameSlotDialog, { open: true, onSubmit: vi.fn(), onCancel }))
    fireEvent.click(screen.getByTestId('slot-name-cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('starts from initialName when renaming', () => {
    render(createElement(NameSlotDialog, { open: true, initialName: 'Date', onSubmit: vi.fn(), onCancel: vi.fn() }))
    expect((screen.getByTestId('slot-name-input') as HTMLInputElement).value).toBe('Date')
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run test/NameSlotDialog.test.ts`: FAIL, module not found.

- [ ] **Step 3: Install `label` and implement**

Run `npx shadcn@latest add label` in `apps/web` (commit the generated `src/components/ui/label.tsx` with this task).

```tsx
'use client'

import { useEffect, useState, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Asked at placement in step 1 (and on rename): every template slot has a
 * name, because the write step's side panel is a form and each field needs
 * a label. A shadcn Dialog rather than a click-anchored popover -- the
 * installed Popover wrapper exposes no anchor, and a modal needs no
 * positioning. Empty (after trimming) is refused; Esc/Cancel places nothing.
 */
export function NameSlotDialog({
  open, initialName = '', onSubmit, onCancel,
}: {
  open: boolean
  initialName?: string
  onSubmit(name: string): void
  onCancel(): void
}) {
  const [name, setName] = useState(initialName)
  useEffect(() => {
    if (open) setName(initialName)
  }, [open, initialName])

  const submit = () => {
    const trimmed = name.trim()
    if (trimmed === '') return
    onSubmit(trimmed)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      submit()
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{initialName ? 'Rename slot' : 'Name this slot'}</DialogTitle>
          <DialogDescription>The name labels this field when the form is filled in.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="slot-name">Name</Label>
          <Input
            id="slot-name"
            data-testid="slot-name-input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Date"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} data-testid="slot-name-cancel">Cancel</Button>
          <Button onClick={submit} disabled={name.trim() === ''} data-testid="slot-name-submit">
            {initialName ? 'Rename' : 'Add slot'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```
Check the installed `dialog.tsx` for the exact exported names (`DialogFooter`, `DialogDescription`); use what it exports.

- [ ] **Step 4: Run to verify it passes** — `npx vitest run test/NameSlotDialog.test.ts && npx eslint src/features/template`: green. (If the disabled submit button makes the "refuses empty" click assertion vacuous, keep it: the guard inside `submit` is still exercised by the Enter path with spaces.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui/label.tsx apps/web/src/features/template/NameSlotDialog.tsx apps/web/test/NameSlotDialog.test.ts
git commit -m "feat(web): dialog to name a slot at placement or rename it"
```

---

### Task 10: `SlotPanel` — chips (step 1) and fields (step 2)

**Files:**
- Create: `apps/web/src/features/template/SlotPanel.tsx`
- Test: `apps/web/test/SlotPanel.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PanelSlot = { id: string; name: string; text: string }
  export function SlotPanel(props: {
    step: Step                              // from templateStore.ts
    slots: PanelSlot[]                      // in panel order
    selectedId: string | null
    onSelect(id: string): void
    onRename(id: string): void              // step 1, double-click a chip
    onRemove(id: string): void              // step 1, chip ✕
    onNext(): void                          // step 1
    onBack(): void                          // step 2
    onChangeText(id: string, text: string): void   // step 2 field typing
    onSave(): void                          // step 2
  })
  ```
  Test ids: `slot-panel`, `slot-chip-<id>`, `slot-chip-remove-<id>`, `slot-field-<id>`, `panel-next`, `panel-back`, `panel-save`.

- [ ] **Step 1: Write the failing tests**

```ts
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotPanel } from '@/features/template/SlotPanel'

const slots = [
  { id: 'a', name: 'CO#', text: '' },
  { id: 'b', name: 'Date', text: '07/11/2024' },
]
const noop = () => {}
const base = {
  slots, selectedId: null, onSelect: noop, onRename: noop, onRemove: noop,
  onNext: noop, onBack: noop, onChangeText: noop, onSave: noop,
}

describe('SlotPanel', () => {
  afterEach(() => cleanup())

  it('step 1: one chip per slot; click selects, ✕ removes, double-click renames; Next', () => {
    const onSelect = vi.fn(), onRemove = vi.fn(), onRename = vi.fn(), onNext = vi.fn()
    render(createElement(SlotPanel, { ...base, step: 'layout', selectedId: 'b', onSelect, onRemove, onRename, onNext }))
    expect(screen.getByTestId('slot-chip-a').textContent).toContain('CO#')
    expect(screen.getByTestId('slot-chip-b').getAttribute('data-selected')).toBe('true')
    fireEvent.click(screen.getByTestId('slot-chip-a'))
    expect(onSelect).toHaveBeenCalledWith('a')
    fireEvent.click(screen.getByTestId('slot-chip-remove-a'))
    expect(onRemove).toHaveBeenCalledWith('a')
    fireEvent.doubleClick(screen.getByTestId('slot-chip-b'))
    expect(onRename).toHaveBeenCalledWith('b')
    fireEvent.click(screen.getByTestId('panel-next'))
    expect(onNext).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('slot-field-a')).toBeNull()
  })

  it('step 1: Next is disabled with no slots', () => {
    render(createElement(SlotPanel, { ...base, slots: [], step: 'layout' }))
    expect((screen.getByTestId('panel-next') as HTMLButtonElement).disabled).toBe(true)
  })

  it('step 2: one labelled field per slot; typing reports; focus selects; Back and Save', () => {
    const onChangeText = vi.fn(), onSelect = vi.fn(), onBack = vi.fn(), onSave = vi.fn()
    render(createElement(SlotPanel, { ...base, step: 'write', onChangeText, onSelect, onBack, onSave }))
    const field = screen.getByTestId('slot-field-b') as HTMLInputElement
    expect(field.value).toBe('07/11/2024')
    expect(screen.getByText('Date')).toBeTruthy()
    fireEvent.focus(field)
    expect(onSelect).toHaveBeenCalledWith('b')
    fireEvent.change(field, { target: { value: '08/01/2024' } })
    expect(onChangeText).toHaveBeenCalledWith('b', '08/01/2024')
    fireEvent.click(screen.getByTestId('panel-back'))
    fireEvent.click(screen.getByTestId('panel-save'))
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('slot-chip-a')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run test/SlotPanel.test.ts`: FAIL, module not found.

- [ ] **Step 3: Implement**

```tsx
'use client'

import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { Step } from '@/lib/persistence/templateStore'

export type PanelSlot = { id: string; name: string; text: string }

/**
 * The left column. Step 1 lists the slots as chips (select / rename /
 * remove) with Next; step 2 turns the same list into a form -- one field
 * per slot, labelled by its name -- with Back and Save. Field text and
 * on-page slot text are one state (see TemplateEditor), so typing here
 * shows on the page immediately.
 */
export function SlotPanel({
  step, slots, selectedId, onSelect, onRename, onRemove, onNext, onBack, onChangeText, onSave,
}: {
  step: Step
  slots: PanelSlot[]
  selectedId: string | null
  onSelect(id: string): void
  onRename(id: string): void
  onRemove(id: string): void
  onNext(): void
  onBack(): void
  onChangeText(id: string, text: string): void
  onSave(): void
}) {
  return (
    <aside
      data-testid="slot-panel"
      className="flex w-72 shrink-0 flex-col gap-4 rounded-lg border border-border bg-muted/40 p-4"
    >
      {step === 'layout' ? (
        <>
          <div>
            <h2 className="text-sm font-medium">Slots</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Click the page to add a slot. Drag to move, use the toolbar to style.
            </p>
          </div>
          <ul className="flex flex-col gap-1.5">
            {slots.map((slot) => (
              <li key={slot.id}>
                {/* The chip is a shadcn Button; the ✕ is a second, nested-looking
                    Button placed beside it (buttons must not nest). */}
                <div
                  data-testid={`slot-chip-${slot.id}`}
                  data-selected={selectedId === slot.id}
                  onClick={() => onSelect(slot.id)}
                  onDoubleClick={() => onRename(slot.id)}
                  className={cn(
                    'flex items-center justify-between rounded-md border border-border bg-background px-3 py-1.5 text-sm',
                    selectedId === slot.id && 'ring-2 ring-ring',
                  )}
                >
                  <span className="truncate">{slot.name}</span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove ${slot.name}`}
                    data-testid={`slot-chip-remove-${slot.id}`}
                    onClick={(e) => { e.stopPropagation(); onRemove(slot.id) }}
                  >
                    <X />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <Button className="mt-auto" onClick={onNext} disabled={slots.length === 0} data-testid="panel-next">
            Next <ArrowRight />
          </Button>
        </>
      ) : (
        <>
          <Button variant="ghost" size="sm" className="self-start" onClick={onBack} data-testid="panel-back">
            <ArrowLeft /> Back
          </Button>
          <h2 className="text-sm font-medium">Form</h2>
          <div className="flex flex-col gap-3">
            {slots.map((slot) => (
              <div key={slot.id} className="grid gap-1.5">
                <Label htmlFor={`slot-field-${slot.id}`}>{slot.name}</Label>
                <Input
                  id={`slot-field-${slot.id}`}
                  data-testid={`slot-field-${slot.id}`}
                  value={slot.text}
                  onFocus={() => onSelect(slot.id)}
                  onChange={(e) => onChangeText(slot.id, e.target.value)}
                />
              </div>
            ))}
          </div>
          <Button className="mt-auto" onClick={onSave} data-testid="panel-save">Save</Button>
        </>
      )}
    </aside>
  )
}
```
If `button.tsx` has no `icon-xs` size, use `icon-sm`. The chip wrapper is a `div` rather than a Button because it contains a Button (the ✕) and buttons cannot nest — say so in the comment (as above).

- [ ] **Step 4: Run to verify it passes** — `npx vitest run test/SlotPanel.test.ts && npx eslint src/features/template`: green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/template/SlotPanel.tsx apps/web/test/SlotPanel.test.ts
git commit -m "feat(web): side panel with slot chips (layout step) and a form (write step)"
```

---

### Task 11: `openFile` — bytes → document + landing decision

**Files:**
- Create: `apps/web/src/features/template/openFile.ts`
- Test: `apps/web/test/openFile.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type OpenedFile = {
    doc: EditorDocument          // doc.id === fileId
    fileId: FileId
    layout: TemplateLayout | null
    values: TemplateValues | null
    step: Step                   // 'write' when a layout exists, else 'layout'
  }
  export async function openFile(
    pdfBytes: Uint8Array, name: string, store: TemplateStore,
  ): Promise<OpenedFile>
  ```
  Identity: `await readSourceStamp(pdfBytes)` first (a downloaded copy), else `await hashBytes(pdfBytes)`, else `crypto.randomUUID()` (no SubtleCrypto — file can't be recognised later; caller warns). Stores the file with `putFile` when it is new.
- Consumes: `normalizePdf`, `readSourceStamp` (core), `hashBytes` (Task 3), `TemplateStore` (Task 4).

- [ ] **Step 1: Write the failing tests**

```ts
import { PDFDocument } from '@cantoo/pdf-lib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderPdf, FONT_IDS, FONT_FILES, type FontBytes, type TemplateLayout } from '@pdf-slot/core'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { TemplateStore } from '@/lib/persistence/templateStore'
import { openFile } from '@/features/template/openFile'

function memoryStore(): TemplateStore & { layouts: Map<string, TemplateLayout>; files: string[] } {
  const layouts = new Map<string, TemplateLayout>()
  const files: string[] = []
  return {
    layouts, files,
    getFile: async () => null,
    putFile: async (f) => { files.push(f.fileId) },
    getLayout: async (id) => layouts.get(id) ?? null,
    putLayout: async (l) => { layouts.set(l.fileId, l) },
    getValues: async () => null,
    putValues: async () => {},
  }
}

async function blankPdf(): Promise<Uint8Array> {
  const d = await PDFDocument.create()
  d.addPage([612, 792])
  return d.save()
}

describe('openFile', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('an unknown PDF lands in the layout step, is stored, and its id is the content hash', async () => {
    const store = memoryStore()
    const bytes = await blankPdf()
    const opened = await openFile(bytes, 'form.pdf', store)
    expect(opened.step).toBe('layout')
    expect(opened.layout).toBeNull()
    expect(opened.fileId).toMatch(/^[0-9a-f]{64}$/)
    expect(opened.doc.id).toBe(opened.fileId)
    expect(store.files).toEqual([opened.fileId])
  })

  it('the same bytes again land in the write step with the saved layout', async () => {
    const store = memoryStore()
    const bytes = await blankPdf()
    const first = await openFile(bytes, 'form.pdf', store)
    store.layouts.set(first.fileId, { fileId: first.fileId, slots: [], updatedAt: 't' })
    const again = await openFile(bytes.slice(), 'renamed.pdf', store)
    expect(again.fileId).toBe(first.fileId)
    expect(again.step).toBe('write')
    expect(again.layout).not.toBeNull()
  })

  it('a copy this tool exported is recognised by its stamp, not its (different) bytes', async () => {
    const store = memoryStore()
    const bytes = await blankPdf()
    const first = await openFile(bytes, 'form.pdf', store)
    store.layouts.set(first.fileId, { fileId: first.fileId, slots: [], updatedAt: 't' })
    const fonts = Object.fromEntries(
      FONT_IDS.map((id) => [id, new Uint8Array(readFileSync(path.resolve(__dirname, '../public/fonts', FONT_FILES[id])))]),
    ) as FontBytes
    const exported = await renderPdf(first.doc, [], fonts)
    const reopened = await openFile(exported, 'edited.pdf', store)
    expect(reopened.fileId).toBe(first.fileId)
    expect(reopened.step).toBe('write')
  })

  it('without SubtleCrypto the file still opens (as new, with a random id)', async () => {
    vi.stubGlobal('crypto', { ...globalThis.crypto, subtle: undefined, randomUUID: () => 'rand-1' })
    const opened = await openFile(await blankPdf(), 'form.pdf', memoryStore())
    expect(opened.fileId).toBe('rand-1')
    expect(opened.step).toBe('layout')
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run test/openFile.test.ts`: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import {
  normalizePdf, readSourceStamp,
  type EditorDocument, type FileId, type TemplateLayout, type TemplateValues,
} from '@pdf-slot/core'
import { hashBytes } from '@/lib/files/fileHash'
import type { Step, TemplateStore } from '@/lib/persistence/templateStore'

export type OpenedFile = {
  doc: EditorDocument
  fileId: FileId
  layout: TemplateLayout | null
  values: TemplateValues | null
  step: Step
}

/**
 * Everything that happens between "here are PDF bytes" and "show the
 * editor": work out which file this is, fetch what we remember about it,
 * and decide which step to land in (spec: known file -> write, new file
 * -> layout).
 *
 * Identity, in order: the stamp an earlier export of ours left in the Info
 * dictionary (a downloaded copy has different bytes from its source), then
 * the content hash, then -- only when SubtleCrypto is missing, i.e. an
 * insecure origin -- a random id, which means the file cannot be
 * recognised next time.
 */
export async function openFile(pdfBytes: Uint8Array, name: string, store: TemplateStore): Promise<OpenedFile> {
  const fileId = (await readSourceStamp(pdfBytes).catch(() => null)) ?? (await hashBytes(pdfBytes)) ?? crypto.randomUUID()
  const doc = await normalizePdf(pdfBytes, fileId)
  const [layout, values, existing] = await Promise.all([
    store.getLayout(fileId), store.getValues(fileId), store.getFile(fileId),
  ])
  if (!existing) {
    await store.putFile({ fileId, name, source: pdfBytes, pages: doc.pages, createdAt: new Date().toISOString() })
  }
  return { doc, fileId, layout, values, step: layout ? 'write' : 'layout' }
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run test/openFile.test.ts && npx tsc --noEmit`: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/template/openFile.ts apps/web/test/openFile.test.ts
git commit -m "feat(web): openFile identifies a PDF (stamp, then hash) and picks the landing step"
```

---

### Task 12: `TemplateEditor` — the two-step shell

**Files:**
- Create: `apps/web/src/features/template/useTemplatePersistence.ts`
- Create: `apps/web/src/features/template/TemplateEditor.tsx`
- Test: `apps/web/test/TemplateEditor.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function TemplateEditor(props: {
    opened: OpenedFile                      // from Task 11
    store: TemplateStore & SessionStore
    onStartOver(): void
  })
  ```
- Consumes: `Editor` (Task 8 props), `useEditorStore` (Task 5), `SlotPanel` (Task 10), `NameSlotDialog` (Task 9), `toSlots`/`toLayout`/`toValues` (Task 1).

Behaviour (the tests below pin each line):
1. Mount: `store.replaceSlots(toSlots(layout, step === 'write' ? values : null))` via `useEditorStore`'s initial value; `names` state from `layout.slots`; `step` from `opened.step`; `sessionStore.put({ fileId, step })`.
2. Step 1: `Editor` with `onPlaceSlot` → opens `NameSlotDialog`; submit → `store.addSlot(atPdf, page)` → record name. Chip ✕ → `store.removeSlot`; double-click → rename dialog. Any slot change → debounced (1s) `putLayout(toLayout(...))`. **Next** → `putLayout` now, `replaceSlots(slots with text cleared)`, step = write, `session.put`.
3. Step 2: `Editor locked highlighted`; `SlotPanel` fields bound to `slot.text`; typing → `store.updateSlot(id, { text })` → debounced (1s) `putValues`. **Save** → `putValues` now + `toast.success('Saved')`. **Back** → `putValues` now, `replaceSlots(slots keeping text)`, step = layout, `session.put`. Coming forward again keeps the text of slots that still exist.
4. Start over → `session.clear()` then `onStartOver()`.

- [ ] **Step 1: Write the failing tests**

```ts
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { EditorDocument, TemplateLayout, TemplateValues, StoredFile } from '@pdf-slot/core'
import type { OpenSession, SessionStore, TemplateStore } from '@/lib/persistence/templateStore'
import type { OpenedFile } from '@/features/template/openFile'

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({
      getPage: async () => ({
        getViewport: () => ({ width: 100, height: 100 }),
        render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
      }),
    }),
    destroy: vi.fn(),
  }),
}))

class FakeFontFace {
  constructor(public family: string, public source: unknown) {}
  async load() { return this }
}
const FONT_DIR = path.resolve(__dirname, '../public/fonts')
const FONT_FILES = ['PT_Sans-Web-Regular.ttf', 'PT_Sans-Web-Bold.ttf', 'PT_Serif-Web-Regular.ttf', 'PT_Serif-Web-Bold.ttf', 'IBMPlexMono-Regular.ttf']

function memoryStore() {
  const layouts = new Map<string, TemplateLayout>()
  const values = new Map<string, TemplateValues>()
  let session: OpenSession | null = null
  const store: TemplateStore & SessionStore & { layouts: typeof layouts; values: typeof values; session(): OpenSession | null } = {
    layouts, values, session: () => session,
    getFile: async () => null,
    putFile: async (_f: StoredFile) => {},
    getLayout: async (id) => layouts.get(id) ?? null,
    putLayout: async (l) => { layouts.set(l.fileId, l) },
    getValues: async (id) => values.get(id) ?? null,
    putValues: async (v) => { values.set(v.fileId, v) },
    get: async () => session,
    put: async (s) => { session = s },
    clear: async () => { session = null },
  }
  return store
}

const doc: EditorDocument = { id: 'file-1', source: new Uint8Array([1, 2, 3]), pages: [{ width: 612, height: 792 }] }
const newFile: OpenedFile = { doc, fileId: 'file-1', layout: null, values: null, step: 'layout' }
const knownLayout: TemplateLayout = {
  fileId: 'file-1', updatedAt: 't',
  slots: [
    { id: 's1', name: 'CO#', order: 0, page: 0, x: 50, y: 700, width: 200, fontId: 'sans', size: 14, color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2 },
    { id: 's2', name: 'Date', order: 1, page: 0, x: 50, y: 650, width: 200, fontId: 'sans', size: 14, color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2 },
  ],
}
const knownFile: OpenedFile = {
  doc, fileId: 'file-1', layout: knownLayout, step: 'write',
  values: { fileId: 'file-1', updatedAt: 't', values: { s2: '07/11/2024' } },
}

async function placeSlot(container: HTMLElement, name: string) {
  const canvas = await waitFor(() => container.querySelector('canvas') as HTMLCanvasElement)
  fireEvent.click(canvas, { clientX: 50, clientY: 50 })
  const input = await waitFor(() => screen.getByTestId('slot-name-input') as HTMLInputElement)
  fireEvent.change(input, { target: { value: name } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

describe('TemplateEditor', () => {
  beforeEach(() => {
    vi.stubGlobal('FontFace', FakeFontFace)
    Object.defineProperty(document, 'fonts', { configurable: true, value: { add: vi.fn() } })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const file = FONT_FILES.find((f) => url.endsWith(f))
      if (!file) throw new Error(`unexpected fetch: ${url}`)
      const bytes = readFileSync(path.join(FONT_DIR, file))
      return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
    }))
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('a new file starts in the layout step; placing asks for a name and adds a chip; ✕ removes the slot from the page', async () => {
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const store = memoryStore()
    const { container } = render(createElement(TemplateEditor, { opened: newFile, store, onStartOver: vi.fn() }))
    expect(screen.getByTestId('panel-next')).toBeTruthy()
    await waitFor(() => expect(store.session()).toEqual({ fileId: 'file-1', step: 'layout' }))

    await placeSlot(container, 'CO#')
    const chip = await waitFor(() => screen.getByTestId(/^slot-chip-(?!remove)/ as never) as HTMLElement)
    expect(chip.textContent).toContain('CO#')
    expect(container.querySelectorAll('[data-slot-id]').length).toBe(1)

    const id = (container.querySelector('[data-slot-id]') as HTMLElement).dataset.slotId!
    fireEvent.click(screen.getByTestId(`slot-chip-remove-${id}`))
    expect(container.querySelectorAll('[data-slot-id]').length).toBe(0)
  })

  it('cancelling the name dialog places nothing', async () => {
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const { container } = render(createElement(TemplateEditor, { opened: newFile, store: memoryStore(), onStartOver: vi.fn() }))
    const canvas = await waitFor(() => container.querySelector('canvas') as HTMLCanvasElement)
    fireEvent.click(canvas, { clientX: 50, clientY: 50 })
    await waitFor(() => screen.getByTestId('slot-name-cancel'))
    fireEvent.click(screen.getByTestId('slot-name-cancel'))
    expect(container.querySelectorAll('[data-slot-id]').length).toBe(0)
  })

  it('Next saves the layout (names, order, no text) and enters the write step with locked, empty slots', async () => {
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const store = memoryStore()
    const { container } = render(createElement(TemplateEditor, { opened: newFile, store, onStartOver: vi.fn() }))
    await placeSlot(container, 'CO#')
    // Sample text typed in step 1 is not a value.
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'sample' } })
    fireEvent.blur(textarea)

    fireEvent.click(screen.getByTestId('panel-next'))

    await waitFor(() => expect(store.layouts.get('file-1')).toBeDefined())
    const saved = store.layouts.get('file-1')!
    expect(saved.slots.map((s) => [s.name, s.order])).toEqual([['CO#', 0]])
    expect('text' in saved.slots[0]!).toBe(false)
    expect(store.session()).toEqual({ fileId: 'file-1', step: 'write' })

    const box = container.querySelector('[data-slot-id]') as HTMLElement
    expect(box.style.cursor).toBe('text')
    const field = screen.getByTestId(`slot-field-${box.dataset.slotId}`) as HTMLInputElement
    expect(field.value).toBe('')
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('')
  })

  it('a known file opens in the write step with its slots and values; typing in a field shows on the page and vice versa; Save persists', async () => {
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const sonner = await import('sonner')
    const success = vi.spyOn(sonner.toast, 'success')
    const store = memoryStore()
    const { container } = render(createElement(TemplateEditor, { opened: knownFile, store, onStartOver: vi.fn() }))

    const dateField = await waitFor(() => screen.getByTestId('slot-field-s2') as HTMLInputElement)
    expect(dateField.value).toBe('07/11/2024')
    expect((container.querySelector('[data-slot-id="s2"] textarea') as HTMLTextAreaElement).value).toBe('07/11/2024')

    fireEvent.change(screen.getByTestId('slot-field-s1'), { target: { value: '001' } })
    expect((container.querySelector('[data-slot-id="s1"] textarea') as HTMLTextAreaElement).value).toBe('001')

    fireEvent.change(container.querySelector('[data-slot-id="s2"] textarea') as HTMLTextAreaElement, { target: { value: '08/01/2024' } })
    expect((screen.getByTestId('slot-field-s2') as HTMLInputElement).value).toBe('08/01/2024')

    fireEvent.click(screen.getByTestId('panel-save'))
    await waitFor(() => expect(store.values.get('file-1')?.values).toEqual({ s1: '001', s2: '08/01/2024' }))
    expect(success).toHaveBeenCalled()
  })

  it('typing in the write step is saved on its own after ~1s, without pressing Save', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const store = memoryStore()
    render(createElement(TemplateEditor, { opened: knownFile, store, onStartOver: vi.fn() }))
    await waitFor(() => screen.getByTestId('slot-field-s1'))
    fireEvent.change(screen.getByTestId('slot-field-s1'), { target: { value: '00' } })
    fireEvent.change(screen.getByTestId('slot-field-s1'), { target: { value: '001' } })
    await vi.advanceTimersByTimeAsync(1100)
    expect(store.values.get('file-1')?.values.s1).toBe('001')
  })

  it('Back returns to the layout step with slots unlocked; Next again keeps the typed values', async () => {
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const store = memoryStore()
    const { container } = render(createElement(TemplateEditor, { opened: knownFile, store, onStartOver: vi.fn() }))
    await waitFor(() => screen.getByTestId('slot-field-s1'))
    fireEvent.change(screen.getByTestId('slot-field-s1'), { target: { value: '001' } })

    fireEvent.click(screen.getByTestId('panel-back'))
    await waitFor(() => screen.getByTestId('panel-next'))
    expect(store.session()).toEqual({ fileId: 'file-1', step: 'layout' })
    expect((container.querySelector('[data-slot-id="s1"]') as HTMLElement).style.cursor).toBe('move')
    expect(screen.getByTestId('font-select-trigger')).toBeTruthy()

    fireEvent.click(screen.getByTestId('panel-next'))
    await waitFor(() => screen.getByTestId('slot-field-s1'))
    expect((screen.getByTestId('slot-field-s1') as HTMLInputElement).value).toBe('001')
    expect((screen.getByTestId('slot-field-s2') as HTMLInputElement).value).toBe('07/11/2024')
  })

  it('Start over clears the open session and hands off', async () => {
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const store = memoryStore()
    const onStartOver = vi.fn()
    render(createElement(TemplateEditor, { opened: knownFile, store, onStartOver }))
    await waitFor(() => expect(store.session()).not.toBeNull())
    fireEvent.click(screen.getByTestId('start-over-button'))
    await waitFor(() => expect(onStartOver).toHaveBeenCalledTimes(1))
    expect(store.session()).toBeNull()
    expect(store.layouts.size).toBe(0) // it never deletes a saved layout (there is none here either way)
  })
})
```
For the first test's chip lookup use `container.querySelector('[data-testid^="slot-chip-"]:not([data-testid^="slot-chip-remove-"])')` instead of the regex `getByTestId` — write it that way.

- [ ] **Step 2: Run to verify it fails** — `npx vitest run test/TemplateEditor.test.ts`: FAIL, module not found.

- [ ] **Step 3: Implement**

`apps/web/src/features/template/useTemplatePersistence.ts`:
```ts
'use client'

import { useEffect, useRef } from 'react'

/**
 * Debounced "write this value ~1s after it last changed", with a flush on
 * unmount so a tab close never drops the last second of edits. The same
 * shape the old session save had; now one instance per thing persisted
 * (layout in step 1, values in step 2).
 */
export function useDebouncedWrite<T>(value: T, write: (value: T) => Promise<void>, delayMs = 1000): void {
  const pending = useRef<T | null>(null)
  const writeRef = useRef(write)
  useEffect(() => {
    writeRef.current = write
  })
  useEffect(() => {
    pending.current = value
    const timer = setTimeout(() => {
      pending.current = null
      void writeRef.current(value)
    }, delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  useEffect(() => {
    const flush = () => {
      if (pending.current === null) return
      const v = pending.current
      pending.current = null
      void writeRef.current(v)
    }
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      flush()
    }
  }, [])
}
```

`apps/web/src/features/template/TemplateEditor.tsx`:
```tsx
'use client'

import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { toLayout, toSlots, toValues, type Point, type Slot } from '@pdf-slot/core'
import type { SessionStore, Step, TemplateStore } from '@/lib/persistence/templateStore'
import { Editor } from '@/features/editor/Editor'
import { useEditorStore } from '@/features/editor/state/useEditorStore'
import { NameSlotDialog } from './NameSlotDialog'
import { SlotPanel } from './SlotPanel'
import { useDebouncedWrite } from './useTemplatePersistence'
import type { OpenedFile } from './openFile'

type Pending =
  | { kind: 'place'; atPdf: Point; page: number }
  | { kind: 'rename'; id: string }
  | null

/**
 * The two-step shell around the editor.
 *
 * Step 1 (layout): place, name, move, style, delete slots. Step 2 (write):
 * the same slots, locked, with a form beside them. The editor works on
 * Slot[] throughout; names live here and meet the slots only at the
 * persistence boundary (toLayout / toSlots). Entering a step replaces the
 * slot list (a boundary undo must not cross); step 1's sample text is
 * dropped on Next, step 2's typed text is kept across Back/Next.
 */
export function TemplateEditor({
  opened, store, onStartOver,
}: {
  opened: OpenedFile
  store: TemplateStore & SessionStore
  onStartOver(): void
}) {
  const { doc, fileId, layout, values } = opened
  const [step, setStep] = useState<Step>(opened.step)
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries((layout?.slots ?? []).map((s) => [s.id, s.name])),
  )
  const editor = useEditorStore(layout ? toSlots(layout, opened.step === 'write' ? values : null) : [])
  const [pending, setPending] = useState<Pending>(null)

  // Record which file/step is open, so a reload lands here again.
  const [sessionKey, setSessionKey] = useState('')
  const key = `${fileId}:${step}`
  if (key !== sessionKey) {
    setSessionKey(key)
    void store.put({ fileId, step })
  }

  // Debounced safety-net writes; Next/Save/Back write immediately below.
  const currentLayout = useMemo(
    () => toLayout(fileId, editor.slots, names, new Date().toISOString()),
    [fileId, editor.slots, names],
  )
  const currentValues = useMemo(() => toValues(fileId, editor.slots, new Date().toISOString()), [fileId, editor.slots])
  useDebouncedWrite(step === 'layout' ? currentLayout : null, async (l) => { if (l) await store.putLayout(l) })
  useDebouncedWrite(step === 'write' ? currentValues : null, async (v) => { if (v) await store.putValues(v) })

  const handlePlaceSlot = useCallback((atPdf: Point, page: number) => {
    setPending({ kind: 'place', atPdf, page })
  }, [])

  const handleNameSubmit = (name: string) => {
    if (!pending) return
    if (pending.kind === 'place') {
      const id = editor.addSlot(pending.atPdf, pending.page)
      setNames((n) => ({ ...n, [id]: name }))
    } else {
      setNames((n) => ({ ...n, [pending.id]: name }))
    }
    setPending(null)
  }

  const handleRemove = (id: string) => {
    editor.removeSlot(id)
    setNames(({ [id]: _dropped, ...rest }) => rest)
  }

  const handleNext = () => {
    void store.putLayout(currentLayout)
    // Step 1 text is sample text, not a value; step 2 starts from what was
    // last written (if anything), never from the sample.
    editor.replaceSlots(editor.slots.map((s) => ({ ...s, text: values?.values[s.id] ?? writtenRef.current[s.id] ?? '' })))
    setStep('write')
  }

  // Text typed in step 2, kept so Back -> Next restores it. Read at Next
  // time only, so it is a ref rather than state.
  const writtenRef = useRefRecord()

  const handleBack = () => {
    void store.putValues(currentValues)
    writtenRef.current = currentValues.values
    editor.replaceSlots(editor.slots)
    setStep('layout')
  }

  const handleSave = () => {
    void store.putValues(currentValues).then(() => toast.success('Saved'))
  }

  const handleStartOver = () => {
    void store.clear().then(onStartOver)
  }

  const panelSlots = editor.slots.map((s) => ({ id: s.id, name: names[s.id] ?? 'Slot', text: s.text }))

  return (
    <div className="flex items-start gap-6">
      <SlotPanel
        step={step}
        slots={panelSlots}
        selectedId={editor.selectedId}
        onSelect={editor.select}
        onRename={(id) => setPending({ kind: 'rename', id })}
        onRemove={handleRemove}
        onNext={handleNext}
        onBack={handleBack}
        onChangeText={(id, text) => editor.updateSlot(id, { text })}
        onSave={handleSave}
      />
      <Editor
        doc={doc}
        store={editor}
        locked={step === 'write'}
        highlighted={step === 'write'}
        onPlaceSlot={step === 'layout' ? handlePlaceSlot : undefined}
        onStartOver={handleStartOver}
      />
      <NameSlotDialog
        open={pending !== null}
        initialName={pending?.kind === 'rename' ? names[pending.id] : ''}
        onSubmit={handleNameSubmit}
        onCancel={() => setPending(null)}
      />
    </div>
  )
}

function useRefRecord() {
  return useRef<Record<string, string>>({})
}
```
Notes for the implementer:
- Import `useRef` and inline `useRefRecord` if the helper reads oddly (`const writtenRef = useRef<Record<string, string>>({})`); declare it **before** `handleNext` uses it.
- `useDebouncedWrite` is called with `null` for the inactive step, and the writer ignores `null` — this keeps hook order stable across steps.
- `editor.replaceSlots` inside `handleBack` keeps text (the slots are passed through unchanged) but clears history and selection, per the spec's "undo stays per step".
- If the `sessionKey` render-time `store.put` trips `react-hooks/set-state-in-render`-style lint rules, move it into a `useEffect` keyed on `[fileId, step, store]` — the tests only observe the stored session.
- Ensure `Editor`'s `useEditorStore(initialSlots)` in the no-store path is unaffected: `TemplateEditor` always passes `store`.

- [ ] **Step 4: Run to verify it passes** — `npx vitest run test/TemplateEditor.test.ts && npx tsc --noEmit && npx eslint src/features/template`: 7 passed, no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/template/TemplateEditor.tsx apps/web/src/features/template/useTemplatePersistence.ts apps/web/test/TemplateEditor.test.ts
git commit -m "feat(web): two-step template editor -- lay out and name slots, then write into them"
```

---

### Task 13: Upload → openFile → TemplateEditor; session restore; page wiring

**Files:**
- Modify: `apps/web/src/features/upload/Dropzone.tsx`
- Modify: `apps/web/src/app/page.tsx`
- Test: `apps/web/test/page.test.ts`, `apps/web/test/decodeImage.test.ts` (unchanged), any Dropzone test present

**Interfaces:**
- `Dropzone` prop becomes `onFile(file: { bytes: Uint8Array; name: string }): void` — it still validates and converts images to PDF bytes, but no longer calls `normalizePdf` (openFile does, with the right id).
- `page.tsx`: state `opened: OpenedFile | null`; on mount, `store.get()` → if a session exists and `store.getFile(fileId)` returns the bytes, `openFile(bytes, name, store)` and override `step` with the session's step; render `TemplateEditor` when `opened`, else `Dropzone`. Start over → `setOpened(null)` (TemplateEditor already cleared the session). A file whose id was random (no SubtleCrypto) gets one `toast.warning('This browser can\'t remember layouts for this file (insecure connection).')` — detect via `opened.fileId.length !== 64`.

- [ ] **Step 1: Write the failing tests**

Read `test/page.test.ts` first and keep its structure; replace its session-restore cases with:

```ts
it('shows the dropzone when nothing is open', async () => { /* existing case, adjusted to the new mocks */ })

it('restores the last open file into its step on load', async () => {
  // Mock '@/lib/persistence/indexedDbTemplateStore' so `templateStore` is an in-memory store
  // whose get() returns { fileId: 'f', step: 'write' } and getFile('f') returns bytes + name,
  // and mock '@/features/template/openFile' to return a known OpenedFile with step 'layout'.
  // Expect: TemplateEditor rendered (data-testid="slot-panel") in the *write* step
  // (data-testid="panel-back" present), i.e. the session's step won over openFile's.
})

it('uploading a file opens it in the template editor', async () => {
  // Mock openFile to resolve a new-file OpenedFile; fire Dropzone's file input change with a
  // File of type application/pdf; expect data-testid="panel-next".
})
```
Write these three fully, following the existing mocking pattern in `page.test.ts` (it already mocks `pdfjs-dist` and fonts).

- [ ] **Step 2: Run to verify they fail** — `npx vitest run test/page.test.ts`: FAIL.

- [ ] **Step 3: Implement**

`Dropzone.tsx`:
- Replace `toEditorDocument` with
  ```ts
  async function toPdfBytes(file: File): Promise<Uint8Array> {
    return isPdfFile(file) ? new Uint8Array(await file.arrayBuffer()) : imageToPdf(await decodeImage(file))
  }
  ```
- Prop: `onFile(file: { bytes: Uint8Array; name: string }): void`; in `processFile`: `onFile({ bytes: await toPdfBytes(file), name: file.name })`. Remove the `normalizePdf`/`EditorDocument` imports.

`page.tsx`:
```tsx
'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Dropzone } from '@/features/upload/Dropzone'
import { TemplateEditor } from '@/features/template/TemplateEditor'
import { openFile, type OpenedFile } from '@/features/template/openFile'
import { templateStore } from '@/lib/persistence/indexedDbTemplateStore'

export default function Home() {
  const [opened, setOpened] = useState<OpenedFile | null>(null)
  const [isRestoring, setIsRestoring] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const session = await templateStore.get()
      if (session) {
        const file = await templateStore.getFile(session.fileId)
        if (file) {
          const result = await openFile(file.source, file.name, templateStore)
          if (!cancelled) setOpened({ ...result, step: session.step })
        }
      }
      if (!cancelled) setIsRestoring(false)
    })()
    return () => { cancelled = true }
  }, [])

  const handleFile = async ({ bytes, name }: { bytes: Uint8Array; name: string }) => {
    try {
      const result = await openFile(bytes, name, templateStore)
      if (result.fileId.length !== 64) {
        toast.warning("This browser can't remember layouts for this file (insecure connection).")
      }
      setOpened(result)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load that file.')
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col justify-center px-6 py-10">
      <h1 className="text-2xl font-medium tracking-tight">PDF Slot Editor</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Lay out named text slots on a PDF once; write into them every time after.
      </p>
      <div className="mt-6">
        {isRestoring ? null : opened ? (
          <TemplateEditor key={`${opened.fileId}:${opened.step}`} opened={opened} store={templateStore} onStartOver={() => setOpened(null)} />
        ) : (
          <Dropzone onFile={(f) => { void handleFile(f) }} />
        )}
      </div>
    </main>
  )
}
```
The `normalizePdf` error messages (invalid / encrypted) now surface from `handleFile`'s catch, keeping the same user-facing copy Dropzone used to show.

- [ ] **Step 4: Run to verify** — `npx vitest run && npx tsc --noEmit && npx eslint src test`: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/upload/Dropzone.tsx apps/web/src/app/page.tsx apps/web/test/page.test.ts
git commit -m "feat(web): uploads open in the two-step template editor; last open file is restored"
```

---

### Task 14: Manual verification, docs, deploy preview

**Files:**
- Modify: `docs/superpowers/specs/2026-09-13-two-step-template-editing-design.md` (note the Dialog-not-Popover deviation under "The two steps")

- [ ] **Step 1: Full check** — from the repo root: `npm run verify` (lint, typecheck, tests, build). Expected: green.

- [ ] **Step 2: Manual run** — `npm run dev`, then in the browser:
  1. Upload the rotated 10-page form used in earlier sessions → lands in step 1; click → name dialog → chip appears, slot selected on page; drag/resize/style work; ✕ removes it.
  2. Next → slots tinted, cursor is text, dragging does nothing, toolbar shows only zoom/pages/Download; typing in a field shows on the page and vice versa; Save toasts "Saved".
  3. Reload → same file, same step, values present.
  4. Download → open the PDF: text where placed. Re-upload that download → lands in step 2 with the layout (stamp match).
  5. Start over → dropzone; re-upload the original → step 2 again (hash match).
  6. Back → step 1 unlocked; Next → values still there.

- [ ] **Step 3: Spec note + commit**

Add under "The two steps": *"Implementation note: the name prompt is a shadcn `Dialog` (the installed Popover wrapper exposes no anchor)."*
```bash
git add docs/superpowers/specs/2026-09-13-two-step-template-editing-design.md
git commit -m "docs(spec): note the name prompt is a Dialog"
```

- [ ] **Step 4: Preview deploy** — from the repo root: `vercel deploy --yes --archive=tgz`; report the URL. Production only on the user's explicit "prod".

---

## Self-review

- **Spec coverage:** two steps and their rules (Tasks 6–8, 10, 12); name on placement + rename (9, 12); chips delete from page (10, 12); landing rules + hash + stamp (2, 3, 11, 13); data model (1); `TemplateStore`/`SessionStore` + IndexedDB v2 dropping `session` (4); debounced layout/values writes + explicit Next/Save/Back writes (12); undo per step via `replaceSlots` (5, 12); storage-unavailable degradation (4); insecure-origin warning (13); step-1 text is sample text (12); Download unchanged (7 keeps it). Out of scope items untouched.
- **Placeholders:** Task 13 Step 1 asks the implementer to write three page tests "fully" following the existing pattern — the expectations are spelled out; acceptable since `page.test.ts`'s mocking scaffold must be reused, not duplicated here.
- **Type consistency:** `Step`/`OpenSession` (Task 4) used by 10–13; `OpenedFile` (11) by 12–13; `addSlot(): string`, `replaceSlots` (5) by 12; Editor props (8) by 12; `SlotPanel` test ids (10) by 12–13; `toSlots/toLayout/toValues` (1) by 12.
