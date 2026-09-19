import { describe, expect, it } from 'vitest'
import { readConfig } from '../src/config.js'

const full = { DATABASE_URL: 'postgres://x', BLOB_READ_WRITE_TOKEN: 't', API_KEY: 'k', WEB_ORIGIN: 'http://localhost:3005' }

describe('readConfig', () => {
  it('reads the four variables', () => {
    expect(readConfig(full)).toEqual({ databaseUrl: 'postgres://x', blobToken: 't', apiKey: 'k', webOrigin: 'http://localhost:3005' })
  })
  it('names every missing variable in one error', () => {
    expect(() => readConfig({ DATABASE_URL: 'postgres://x' })).toThrow(/BLOB_READ_WRITE_TOKEN, API_KEY, WEB_ORIGIN/)
  })
  it('strips a trailing slash from WEB_ORIGIN so it matches the browser Origin header', () => {
    // A browser sends `Origin: https://app.example.com` (no path, no slash); the CORS check is an exact
    // string compare, so a copy-pasted URL with a trailing slash would silently block every request.
    expect(readConfig({ ...full, WEB_ORIGIN: 'https://app.example.com/' }).webOrigin).toBe('https://app.example.com')
    expect(readConfig({ ...full, WEB_ORIGIN: 'https://app.example.com' }).webOrigin).toBe('https://app.example.com')
  })
  it('allows BLOB_DIR in place of BLOB_READ_WRITE_TOKEN for local development', () => {
    expect(readConfig({ DATABASE_URL: 'postgres://x', API_KEY: 'k', WEB_ORIGIN: 'o', BLOB_DIR: '/tmp/blobs' })).toEqual({
      databaseUrl: 'postgres://x',
      blobToken: '',
      apiKey: 'k',
      webOrigin: 'o',
      blobDir: '/tmp/blobs',
    })
  })
})
