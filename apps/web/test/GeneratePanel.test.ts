import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GeneratePanel } from '@/features/generate/GeneratePanel'

const fileId = 'a'.repeat(64)
const okJson = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const status = (over: Partial<Record<string, unknown>>) => ({
  id: 'j1', fileId, status: 'running', total: 2, done: 1, failed: 0, error: null, createdAt: '2026-09-19T00:00:00.000Z', finishedAt: null,
  items: [{ index: 0, status: 'done', error: null }, { index: 1, status: 'pending', error: null }], ...over,
})

describe('GeneratePanel', () => {
  const fetchMock = vi.fn<typeof fetch>()
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); localStorage.clear() })
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })

  it('submits records with the key, shows progress, then the zip link and failed rows', async () => {
    fetchMock
      .mockResolvedValueOnce(okJson({ jobId: 'j1' }, 202))
      .mockResolvedValueOnce(okJson(status({})))
      .mockResolvedValueOnce(okJson(status({ status: 'done', done: 1, failed: 1, finishedAt: 't2', items: [{ index: 0, status: 'done', error: null }, { index: 1, status: 'failed', error: 'bad char' }] })))
    render(createElement(GeneratePanel, { apiUrl: 'http://api.test', fileId }))
    fireEvent.change(screen.getByTestId('generate-key'), { target: { value: 'k' } })
    fireEvent.change(screen.getByTestId('generate-records'), { target: { value: '[{"Name":"A"},{"Name":"B"}]' } })
    fireEvent.click(screen.getByTestId('generate-submit'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe(`http://api.test/files/${fileId}/jobs`)
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer k')
    expect(JSON.parse(String(init?.body))).toEqual({ records: [{ Name: 'A' }, { Name: 'B' }] })
    await waitFor(() => expect(screen.getByTestId('generate-progress').textContent).toContain('1 / 2'))
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    await waitFor(() => expect(screen.getByTestId('generate-zip').getAttribute('href')).toBe('http://api.test/jobs/j1/zip'))
    expect(screen.getByTestId('generate-failures').textContent).toContain('Row 2: bad char')
    expect(localStorage.getItem('pdf-slot-api-key')).toBe('k')
  })

  it('shows a parse error without calling the API', () => {
    render(createElement(GeneratePanel, { apiUrl: 'http://api.test', fileId }))
    fireEvent.change(screen.getByTestId('generate-records'), { target: { value: 'nope' } })
    fireEvent.click(screen.getByTestId('generate-submit'))
    expect(screen.getByTestId('generate-error').textContent).toMatch(/JSON array or CSV/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a blank API key without overwriting the previously-saved one', () => {
    localStorage.setItem('pdf-slot-api-key', 'saved')
    render(createElement(GeneratePanel, { apiUrl: 'http://api.test', fileId }))
    fireEvent.change(screen.getByTestId('generate-key'), { target: { value: '' } })
    fireEvent.change(screen.getByTestId('generate-records'), { target: { value: '[{"Name":"A"}]' } })
    fireEvent.click(screen.getByTestId('generate-submit'))
    expect(screen.getByTestId('generate-error').textContent).toBe('Enter your API key')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(localStorage.getItem('pdf-slot-api-key')).toBe('saved')
  })
})
