import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createJob, fetchJob } from '@/features/generate/jobsClient'

const fileId = 'a'.repeat(64)
const okJson = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('jobsClient', () => {
  const fetchMock = vi.fn<typeof fetch>()
  beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset() })
  afterEach(() => vi.unstubAllGlobals())

  it('createJob posts the records with the key and returns the job id', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ jobId: 'j1' }, 202))
    await expect(createJob('http://api.test/', fileId, [{ Name: 'A' }], 'k')).resolves.toEqual({ jobId: 'j1' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe(`http://api.test/files/${fileId}/jobs`)
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer k')
    expect(JSON.parse(String(init?.body))).toEqual({ records: [{ Name: 'A' }] })
  })

  it('a 202 without a job id is an error, not a job with an undefined id', async () => {
    // A proxy or a drifted server can answer 202 with some other body; polling `/jobs/undefined`
    // would then spin forever. The client says what went wrong instead.
    fetchMock.mockResolvedValueOnce(okJson({}, 202))
    await expect(createJob('http://api.test', fileId, [{ Name: 'A' }], 'k')).resolves.toEqual({ error: 'The server did not return a job id' })
    fetchMock.mockResolvedValueOnce(okJson({ jobId: 42 }, 202))
    await expect(createJob('http://api.test', fileId, [{ Name: 'A' }], 'k')).resolves.toEqual({ error: 'The server did not return a job id' })
  })

  it('a refused key, a rejection with a reason, and an unreachable API each report their own error', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ error: { code: 'unauthorized', message: 'Invalid or missing API key' } }, 401))
    await expect(createJob('http://api.test', fileId, [{ Name: 'A' }], 'k')).resolves.toEqual({ error: 'The API key was refused' })
    fetchMock.mockResolvedValueOnce(okJson({ error: { code: 'not_found', message: 'File not found' } }, 404))
    await expect(createJob('http://api.test', fileId, [{ Name: 'A' }], 'k')).resolves.toEqual({ error: 'File not found' })
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(createJob('http://api.test', fileId, [{ Name: 'A' }], 'k')).resolves.toEqual({ error: 'The API is unreachable' })
  })

  it('fetchJob parses a status and is null for a missing job or a network failure', async () => {
    const status = {
      id: 'j1', fileId, status: 'running', total: 1, done: 0, failed: 0, error: null, createdAt: '2026-09-19T00:00:00.000Z', finishedAt: null,
      items: [{ index: 0, status: 'pending', error: null }],
    }
    fetchMock.mockResolvedValueOnce(okJson(status))
    await expect(fetchJob('http://api.test', 'j1')).resolves.toEqual(status)
    fetchMock.mockResolvedValueOnce(okJson({ error: { code: 'not_found', message: 'Job not found' } }, 404))
    await expect(fetchJob('http://api.test', 'j1')).resolves.toBeNull()
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(fetchJob('http://api.test', 'j1')).resolves.toBeNull()
  })
})
