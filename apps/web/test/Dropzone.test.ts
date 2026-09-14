import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Dropzone } from '@/features/upload/Dropzone'

const pdf = () => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2])], 'form.pdf', { type: 'application/pdf' })

describe('Dropzone', () => {
  afterEach(() => cleanup())

  it('a file dropped on the box is handed over', async () => {
    const onFile = vi.fn()
    render(createElement(Dropzone, { onFile }))
    const box = screen.getByTestId('dropzone')
    fireEvent.drop(box, { dataTransfer: { files: [pdf()], types: ['Files'] } })
    await waitFor(() => expect(onFile).toHaveBeenCalledTimes(1))
    expect(onFile.mock.calls[0]![0].name).toBe('form.pdf')
  })

  it('a file dropped anywhere on the page is handed over too, and the browser does not open it', async () => {
    // Users drop wherever the cursor lands; without a page-wide target the
    // browser navigates to the PDF and the app is gone.
    const onFile = vi.fn()
    render(createElement(Dropzone, { onFile }))
    const over = new Event('dragover', { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown }
    Object.defineProperty(over, 'dataTransfer', { value: { types: ['Files'] } })
    document.body.dispatchEvent(over)
    expect(over.defaultPrevented).toBe(true)
    const drop = new Event('drop', { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown }
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [pdf()], types: ['Files'] } })
    document.body.dispatchEvent(drop)
    expect(drop.defaultPrevented).toBe(true)
    await waitFor(() => expect(onFile).toHaveBeenCalledTimes(1))
  })

  it('dragging a file over the page highlights the box; leaving the window clears it', async () => {
    render(createElement(Dropzone, { onFile: vi.fn() }))
    const box = screen.getByTestId('dropzone')
    const enter = new Event('dragenter', { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown }
    Object.defineProperty(enter, 'dataTransfer', { value: { types: ['Files'] } })
    document.body.dispatchEvent(enter)
    await waitFor(() => expect(box.dataset.dragOver).toBe('true'))
    const leave = new Event('dragleave', { bubbles: true }) as Event & { relatedTarget: null }
    Object.defineProperty(leave, 'relatedTarget', { value: null })
    document.body.dispatchEvent(leave)
    await waitFor(() => expect(box.dataset.dragOver).toBe('false'))
  })

  it('a non-file drag (e.g. selected text) is ignored', async () => {
    const onFile = vi.fn()
    render(createElement(Dropzone, { onFile }))
    const drop = new Event('drop', { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown }
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [], types: ['text/plain'] } })
    document.body.dispatchEvent(drop)
    expect(drop.defaultPrevented).toBe(false)
    await new Promise((r) => setTimeout(r, 10))
    expect(onFile).not.toHaveBeenCalled()
  })
})
