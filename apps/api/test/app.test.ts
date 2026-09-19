import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { testDeps } from './helpers/deps.js'

describe('app', () => {
  it('answers health and CORS for the web origin', async () => {
    const app = createApp(await testDeps())
    const res = await app.request('/health', { headers: { Origin: 'http://web.test' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(res.headers.get('access-control-allow-origin')).toBe('http://web.test')
  })
  it('unknown routes are a JSON 404 in the error envelope', async () => {
    const app = createApp(await testDeps())
    const res = await app.request('/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'Not found' } })
  })
})
