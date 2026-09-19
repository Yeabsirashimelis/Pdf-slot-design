import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { testDeps } from './helpers/deps.js'
import { FILE_ID, putTestFile, slot } from './helpers/fixtures.js'

const json = (body: unknown) => ({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

describe('/files/:id/layout and /values', () => {
  it('404 before the file exists and before a layout is saved; round-trips afterwards', async () => {
    const app = createApp(await testDeps())
    expect((await app.request(`/files/${FILE_ID}/layout`)).status).toBe(404)
    await putTestFile(app)
    expect((await app.request(`/files/${FILE_ID}/layout`)).status).toBe(404)
    const layout = { fileId: FILE_ID, updatedAt: '2026-09-19T00:00:00.000Z', slots: [slot(), slot({ id: 's2', name: 'Date', order: 1 })] }
    expect((await app.request(`/files/${FILE_ID}/layout`, json(layout))).status).toBe(204)
    expect(await (await app.request(`/files/${FILE_ID}/layout`)).json()).toEqual(layout)
    const values = { fileId: FILE_ID, updatedAt: '2026-09-19T00:00:01.000Z', values: { s1: 'Abel' } }
    expect((await app.request(`/files/${FILE_ID}/values`, json(values))).status).toBe(204)
    expect(await (await app.request(`/files/${FILE_ID}/values`)).json()).toEqual(values)
  })
  it('refuses a layout with two slots of one name (409) and a body whose fileId disagrees with the path (400)', async () => {
    const app = createApp(await testDeps())
    await putTestFile(app)
    const dup = { fileId: FILE_ID, updatedAt: '2026-09-19T00:00:00.000Z', slots: [slot(), slot({ id: 's2' })] }
    const res = await app.request(`/files/${FILE_ID}/layout`, json(dup))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toEqual({ code: 'duplicate_slot_name', message: 'Two slots are named "Name"' })
    expect((await app.request(`/files/${FILE_ID}/layout`, json({ ...dup, slots: [slot()], fileId: 'a'.repeat(64) }))).status).toBe(400)
  })
})
