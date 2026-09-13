import { afterEach, describe, expect, it, vi } from 'vitest'
import { hashBytes, randomId } from '@/lib/files/fileHash'

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

describe('randomId', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is 32 lowercase hex chars and differs between calls', () => {
    const a = randomId()
    const b = randomId()
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(b).toMatch(/^[0-9a-f]{32}$/)
    expect(a).not.toBe(b)
  })

  it('does not need SubtleCrypto or randomUUID (both are secure-context-only)', () => {
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) })
    expect(randomId()).toMatch(/^[0-9a-f]{32}$/)
  })
})
