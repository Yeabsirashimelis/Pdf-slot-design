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
