import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Button } from '@/components/ui/button'
import { GeneratePanel } from '@/features/generate/GeneratePanel'

const fileId = 'a'.repeat(64)
/**
 * The shadcn/Base UI Button bakes its `disabled` prop into the onClick handler it attaches to the
 * DOM node, so neither removing the `disabled` attribute nor `fireEvent.click` gets past it (the
 * check runs on the closed-over prop, not the DOM). To prove `submit()` refuses on its own -- not
 * just because the button happens to be disabled -- this walks up the fiber tree from the DOM node
 * to the `<Button>` element we wrote and calls the `onClick` we gave it directly, unmerged.
 */
const clickDirectly = (element: HTMLElement) => {
  const fiberKey = Object.keys(element).find((k) => k.startsWith('__reactFiber$'))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fiber = fiberKey ? (element as any)[fiberKey] : undefined
  while (fiber && fiber.type !== Button) fiber = fiber.return
  const onClick = fiber?.memoizedProps?.onClick as (() => void) | undefined
  if (!onClick) throw new Error('could not find the onClick handler on <Button>')
  onClick()
}
const okJson = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const status = (over: Partial<Record<string, unknown>>) => ({
  id: 'j1', fileId, status: 'running', total: 2, done: 1, failed: 0, error: null, createdAt: '2026-09-19T00:00:00.000Z', finishedAt: null,
  items: [{ index: 0, status: 'done', error: null }, { index: 1, status: 'pending', error: null }], ...over,
})

const panel = (slotNames: string[] = ['Name']) =>
  render(createElement(GeneratePanel, { apiUrl: 'http://api.test', fileId, slotNames }))
const type = (value: string) => fireEvent.change(screen.getByTestId('generate-records'), { target: { value } })
const pick = (file: File) => fireEvent.change(screen.getByTestId('generate-file'), { target: { files: [file] } })
const records = () => (screen.getByTestId('generate-records') as HTMLTextAreaElement).value
const submit = () => screen.getByTestId('generate-submit') as HTMLButtonElement

describe('GeneratePanel', () => {
  const fetchMock = vi.fn<typeof fetch>()
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); localStorage.clear() })
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })

  it('submits records with the key, shows progress, then the zip link and failed rows', async () => {
    fetchMock
      .mockResolvedValueOnce(okJson({ jobId: 'j1' }, 202))
      .mockResolvedValueOnce(okJson(status({})))
      .mockResolvedValueOnce(okJson(status({ status: 'done', done: 1, failed: 1, finishedAt: 't2', items: [{ index: 0, status: 'done', error: null }, { index: 1, status: 'failed', error: 'bad char' }] })))
    panel()
    fireEvent.change(screen.getByTestId('generate-key'), { target: { value: 'k' } })
    type('[{"Name":"A"},{"Name":"B"}]')
    fireEvent.click(submit())
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

  it('shows a parse error and refuses to generate at all', () => {
    panel()
    type('Name,Name\nAbel,Sara\n')
    expect(screen.getByTestId('generate-summary').textContent).toBe('Two columns are named "Name"')
    expect(submit().disabled).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a blank API key without overwriting the previously-saved one', () => {
    localStorage.setItem('pdf-slot-api-key', 'saved')
    panel()
    fireEvent.change(screen.getByTestId('generate-key'), { target: { value: '' } })
    type('[{"Name":"A"}]')
    fireEvent.click(submit())
    expect(screen.getByTestId('generate-error').textContent).toBe('Enter your API key')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(localStorage.getItem('pdf-slot-api-key')).toBe('saved')
  })

  it('summarises how many rows and which columns the data has', () => {
    panel(['Name', 'Date'])
    type('Name,Date\nAbel,18 Sep\nSara,19 Sep\n')
    expect(screen.getByTestId('generate-summary').textContent).toContain('2 rows · columns: Name, Date')
    expect(submit().disabled).toBe(false)
  })

  it('imports a .csv file into the box, shows its name, and clears the last error', async () => {
    panel(['Name', 'Date'])
    pick(new File(['x'], 'notes.txt', { type: 'text/plain' }))
    await waitFor(() => expect(screen.getByTestId('generate-error')).toBeTruthy())
    const csv = 'Name,Date\nAbel,18 Sep\n'
    pick(new File([csv], 'rows.csv', { type: 'text/csv' }))
    await waitFor(() => expect(records()).toBe(csv))
    expect(screen.getByTestId('generate-file-name').textContent).toBe('rows.csv')
    expect(screen.queryByTestId('generate-error')).toBeNull()
    expect(screen.getByTestId('generate-summary').textContent).toContain('1 row · columns: Name, Date')
  })

  it('refuses a file that is neither .csv nor .json, and leaves the pasted text alone', async () => {
    panel()
    type('[{"Name":"A"}]')
    pick(new File(['Name\nAbel\n'], 'rows.txt', { type: 'text/plain' }))
    await waitFor(() => expect(screen.getByTestId('generate-error').textContent).toBe('Choose a .csv or .json file'))
    expect(records()).toBe('[{"Name":"A"}]')
    expect(screen.queryByTestId('generate-file-name')).toBeNull()
  })

  it('refuses a file over 5 MB, naming its size, and leaves the pasted text alone', async () => {
    panel()
    type('[{"Name":"A"}]')
    pick(new File(['x'.repeat(6 * 1024 * 1024)], 'huge.csv', { type: 'text/csv' }))
    await waitFor(() => expect(screen.getByTestId('generate-error').textContent).toBe('That file is 6.0 MB; the limit is 5 MB'))
    expect(records()).toBe('[{"Name":"A"}]')
  })

  it('warns about a column that matches no slot and a slot no column fills, but still generates', () => {
    panel(['Name', 'Date'])
    type('Nmae,Date\nAbel,18 Sep\n')
    const summary = screen.getByTestId('generate-summary').textContent ?? ''
    expect(summary).toContain('Ignored: "Nmae" matches no slot. Did you mean "Name"?')
    expect(summary).toContain('Left blank: "Name" has no column.')
    expect(submit().disabled).toBe(false)
  })

  it('leaves out the guess when an unknown column resembles no slot', () => {
    panel(['Name', 'Date'])
    type('Name,Invoice reference\nAbel,7\n')
    expect(screen.getByTestId('generate-summary').textContent).toContain('Ignored: "Invoice reference" matches no slot.')
    expect(screen.getByTestId('generate-summary').textContent).not.toContain('Did you mean')
    expect(submit().disabled).toBe(false)
  })

  it('refuses to generate when not one column matches a slot', () => {
    panel(['Name', 'Date'])
    type('Full name,Day\nAbel,18 Sep\n')
    expect(screen.getByTestId('generate-summary').textContent).toContain('None of these columns match your slots (Name, Date)')
    expect(submit().disabled).toBe(true)
  })

  it('refuses to call the API when submit runs directly, even if the button were somehow enabled', () => {
    // The disabled prop is a convenience, not the guard: submit() must enforce the all-unknown-
    // columns rule itself, since it is the function that would otherwise send the request.
    panel(['Name', 'Date'])
    fireEvent.change(screen.getByTestId('generate-key'), { target: { value: 'k' } })
    type('Full name,Day\nAbel,18 Sep\n')
    act(() => clickDirectly(submit()))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByTestId('generate-error').textContent).toBe('None of these columns match your slots (Name, Date)')
  })

  it('shows an error when the file cannot be read, and leaves the pasted text alone', async () => {
    panel()
    type('[{"Name":"A"}]')
    const file = new File(['x'], 'rows.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'text', { value: () => Promise.reject(new Error('boom')) })
    pick(file)
    await waitFor(() => expect(screen.getByTestId('generate-error').textContent).toBe('Could not read that file'))
    expect(records()).toBe('[{"Name":"A"}]')
    expect(screen.queryByTestId('generate-file-name')).toBeNull()
  })
})
