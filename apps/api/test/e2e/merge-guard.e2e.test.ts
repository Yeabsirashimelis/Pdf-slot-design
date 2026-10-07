// Installs a global IndexedDB before any web module can look for one.
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { normalizePdf, renderPdf, toSlots, type TemplateLayout } from '@pdf-slot/core'
import { templateLayoutSchema, templateSlotSchema } from '@pdf-slot/contracts'
import { openFile } from '@/features/template/openFile'
import { selectStores } from '@/lib/persistence'
import { createHttpTemplateStore } from '@/lib/persistence/httpTemplateStore'
import { templateStore as idb } from '@/lib/persistence/indexedDbTemplateStore'
import { requireContentStreamText } from '../../../../packages/core/test/helpers/content-stream.js'
import { FILE_ID, putTestFile, slot, twoPagePdf } from '../helpers/fixtures.js'
import { API_KEY, API_URL, bootApi, fonts, openZip, type BootedApi } from './helpers.js'

/**
 * A merge guard.
 *
 * The backend is a set of *wires*: the web app reads its storage through a selector that may or
 * may not point at the server; the server's zod schema and database columns must know every
 * field a layout carries; the generate panel has to be mounted somewhere a user can reach; and
 * bulk output has to come off the same renderer as the preview. Each wire is one or two lines of
 * code in a file that other work — a UI rewrite, a new slot kind, a refactor of the panels —
 * has every reason to touch. The rest of the suites test the pieces; nothing there fails when a
 * wire is quietly cut, because each piece still passes on its own.
 *
 * So every test below names the thing a user loses when it fails. If one failed while you were
 * merging, the fix is to re-attach the wire in the new code, not to delete the test.
 */

const UPDATED_AT = '2026-09-19T00:00:00.000Z'
const CREATED_AT = '2026-09-19T00:00:00.000Z'
const PAGES = [{ width: 612, height: 792 }, { width: 612, height: 792 }]
const jsonHeaders = { 'Content-Type': 'application/json' }

const webSrc = (path: string) => fileURLToPath(new URL(`../../../web/src/${path}`, import.meta.url))
const coreSrc = (path: string) => fileURLToPath(new URL(`../../../../packages/core/src/${path}`, import.meta.url))

const oneSlotLayout = (): TemplateLayout => ({
  fileId: FILE_ID,
  updatedAt: UPDATED_AT,
  slots: [slot()] as TemplateLayout['slots'],
})

const putJson = (api: BootedApi, path: string, body: unknown) =>
  api.app.request(path, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(body) })

/**
 * The property names a TypeScript type declares, read out of the source text.
 *
 * Types are erased before this test runs, so there is nothing at runtime to reflect over, and a
 * compile-time trick (`satisfies`, a mapped type) only fails once someone writes the mapping —
 * which is exactly the step a merge forgets. Reading the declaration is crude but it catches the
 * case that matters: a field added to the type and nowhere else.
 *
 * The scan walks the braces rather than matching a line pattern, because these types are written
 * both ways: `TemplateLayout` is one line of semicolon-separated fields, `Slot` is one field per
 * line. Only depth-zero names count, so a nested `{ r: number }` does not contribute `r`.
 */
function declaredFields(source: string, typeName: string): string[] {
  const start = source.indexOf(`export type ${typeName} = {`)
  if (start === -1) throw new Error(`${typeName} is no longer declared as an object type literal; teach this guard the new shape`)
  const open = source.indexOf('{', start)
  let depth = 0
  let end = -1
  for (let i = open; i < source.length; i++) {
    const ch = source[i]
    if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) { end = i; break }
  }
  if (end === -1) throw new Error(`${typeName}'s declaration is unbalanced`)

  const body = source
    .slice(open + 1, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')

  const fields: string[] = []
  let segment = ''
  depth = 0
  for (const ch of body) {
    if ('{[<('.includes(ch)) depth++
    else if ('}]>)'.includes(ch)) depth--
    if (depth === 0 && (ch === ';' || ch === ',' || ch === '\n')) {
      fields.push(segment)
      segment = ''
    } else segment += ch
  }
  fields.push(segment)

  return fields.flatMap((f) => {
    const named = /^\s*(?:readonly\s+)?([A-Za-z_]\w*)\??\s*:/.exec(f)
    return named ? [named[1]!] : []
  })
}

describe('merge guard: the backend stays wired to the app', () => {
  it('the shared schema carries every field a layout has', () => {
    // Loses: anything the type gained and the schema did not -- tables, say -- is stripped by the
    // API on the way in and is gone from the user's saved template without a single error shown.
    const source = readFileSync(coreSrc('document/template.ts'), 'utf8')
    const layoutFields = declaredFields(source, 'TemplateLayout')
    expect(layoutFields.length).toBeGreaterThan(0)
    expect(
      Object.keys(templateLayoutSchema.shape).sort(),
      'TemplateLayout gained or lost a field. Add it to templateLayoutSchema in packages/contracts AND to the layouts table in apps/api (a migration), or the API will silently discard it on save.',
    ).toEqual([...layoutFields].sort())
  })

  it('the shared schema carries every field a slot has', () => {
    // Loses: a new slot property (a rotation, a border, a cell reference) is dropped on save, so
    // the reopened template is not the one the user laid out.
    const types = readFileSync(coreSrc('document/types.ts'), 'utf8')
    // TemplateSlot is `Omit<Slot, 'text'> & { name; order }`, so the fields to compare are Slot's
    // own minus `text`, plus those two.
    const slotFields = declaredFields(types, 'Slot').filter((f) => f !== 'text')
    expect(slotFields.length).toBeGreaterThan(0)
    expect(
      Object.keys(templateSlotSchema.shape).sort(),
      'Slot or TemplateSlot gained or lost a field. Mirror it in templateSlotSchema in packages/contracts, or the API will silently discard it.',
    ).toEqual([...slotFields, 'name', 'order'].sort())
  })

  it('a layout put through the API comes back exactly as it was sent', () => expectLayoutRoundTrip())

  it('the app picks its storage through the selector, so the server can be switched on at all', async () => {
    // Loses: an import that reaches past the selector (straight at IndexedDB) makes the web app
    // ignore the server entirely -- files save nowhere shared, and nobody notices until a second
    // browser shows an empty list.
    const page = readFileSync(webSrc('app/page.tsx'), 'utf8')
    expect(
      page,
      "page.tsx must read its store from '@/lib/persistence' (the selector), not from a store module directly.",
    ).toMatch(/from '@\/lib\/persistence'/)
    expect(page).not.toMatch(/from '@\/lib\/persistence\/indexedDbTemplateStore'/)

    const api = await bootApi()
    vi.stubGlobal('fetch', api.fetchViaApp)
    try {
      // No URL: the very same object, so the old behaviour cannot have been wrapped or altered.
      expect(selectStores({}, idb, createHttpTemplateStore)).toBe(idb)

      // A URL: reads and writes land on the server.
      const remote = selectStores({ apiUrl: API_URL }, idb, createHttpTemplateStore)
      expect((await putTestFile(api.app)).status).toBe(204)
      await remote.putLayout(oneSlotLayout())
      expect(await remote.getLayout(FILE_ID)).toEqual(oneSlotLayout())
      expect((await api.app.request(`/files/${FILE_ID}/layout`)).status).toBe(200)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('without an API URL the app makes no network calls at all', async () => {
    // Loses: the browser-only mode starts depending on a server that may not exist -- the app
    // that used to work offline now warns, or worse, hangs on every save.
    const fetchSpy = vi.fn<typeof fetch>(async () => new Response('the fallback must not reach the network', { status: 500 }))
    vi.stubGlobal('fetch', fetchSpy)
    try {
      const store = selectStores({}, idb, createHttpTemplateStore)
      const bytes = await twoPagePdf()
      const opened = await openFile(bytes, 'form.pdf', store)
      await store.putLayout({ ...oneSlotLayout(), fileId: opened.fileId })
      expect(await store.getLayout(opened.fileId)).toMatchObject({ fileId: opened.fileId })
      await store.put({ fileId: opened.fileId })
      expect(await store.get()).toEqual({ fileId: opened.fileId })
      expect(fetchSpy, 'the IndexedDB fallback called fetch; it must work with no server reachable').not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('the generate panel is mounted wherever the editor lives', () => {
    // Loses: the server keeps working, but nobody can start a bulk job -- the feature is present
    // in the bundle and unreachable in the UI.
    const mount = readFileSync(webSrc('features/template/TemplateEditor.tsx'), 'utf8')
    const guidance = 'If the editor was restructured, move the GeneratePanel mount into the new shell and point this test at that file -- do not delete it.'
    expect(mount, guidance).toMatch(/GeneratePanel/)
    expect(mount, guidance).toMatch(/apiUrl/)
    expect(mount, `${guidance} The panel needs the slot names to check a data file's columns.`).toMatch(/slotNames/)
  })

  it('a generated PDF still draws exactly what the editor would draw', async () => {
    // Loses: bulk output drifts from the preview -- the thing this product promises never happens.
    const api = await bootApi()
    const source = await twoPagePdf()
    expect((await putTestFile(api.app, FILE_ID, source)).status).toBe(204)
    const layout = oneSlotLayout()
    expect((await putJson(api, `/files/${FILE_ID}/layout`, layout)).status).toBe(204)

    const created = await api.app.request(`/files/${FILE_ID}/jobs`, {
      method: 'POST',
      headers: { ...jsonHeaders, Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({ records: [{ Name: 'Abel Tesfaye' }] }),
    })
    expect(created.status).toBe(202)
    const { jobId } = (await created.json()) as { jobId: string }
    await api.runJob(jobId)

    const zip = await api.app.request(`/jobs/${jobId}/zip`)
    expect(zip.status).toBe(200)
    const entries = openZip(new Uint8Array(await zip.arrayBuffer()))
    const generated = entries['record-0001.pdf']
    expect(generated).toBeDefined()

    const doc = await normalizePdf(source, FILE_ID)
    const expected = await renderPdf(doc, toSlots(layout, { fileId: FILE_ID, updatedAt: UPDATED_AT, values: { s1: 'Abel Tesfaye' } }), fonts)
    expect(
      requireContentStreamText(generated!),
      'the server drew something different from the editor: bulk generation and the preview must share renderPdf and toSlots',
    ).toBe(requireContentStreamText(expected))
  })

  it('the API refuses a layout with two slots of one name', async () => {
    // Loses: bulk matches a column to a slot by name, so two slots called "Name" make a column
    // ambiguous -- one of them silently stays blank on every generated PDF.
    const api = await bootApi()
    expect((await putTestFile(api.app)).status).toBe(204)
    const duplicate: TemplateLayout = {
      fileId: FILE_ID,
      updatedAt: UPDATED_AT,
      slots: [slot(), slot({ id: 's2', order: 1 })] as TemplateLayout['slots'],
    }
    const res = await putJson(api, `/files/${FILE_ID}/layout`, duplicate)
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('duplicate_slot_name')
  })
})

/** Shared by the round-trip case; kept a function so the `it` above reads as one line. */
async function expectLayoutRoundTrip(): Promise<void> {
  // Loses: whatever the API drops on the way in or out is gone from the user's template, and the
  // only sign is that the editor reopens without it.
  const api = await bootApi()
  expect((await putTestFile(api.app)).status).toBe(204)
  const layout = oneSlotLayout()
  expect((await putJson(api, `/files/${FILE_ID}/layout`, layout)).status).toBe(204)

  const res = await api.app.request(`/files/${FILE_ID}/layout`)
  expect(res.status).toBe(200)
  expect(await res.json(), 'the API changed a layout in the round trip; every field must survive untouched').toEqual(layout)

  // The file's own metadata matters just as much: it is what the start screen lists.
  vi.stubGlobal('fetch', api.fetchViaApp)
  try {
    const store = createHttpTemplateStore(API_URL)
    expect(await store.listFiles()).toEqual([
      { fileId: FILE_ID, name: 'form.pdf', pageCount: PAGES.length, slotCount: 1, updatedAt: UPDATED_AT },
    ])
    expect(await store.getFile(FILE_ID)).toMatchObject({ fileId: FILE_ID, name: 'form.pdf', pages: PAGES, createdAt: CREATED_AT })
  } finally {
    vi.unstubAllGlobals()
  }
}
