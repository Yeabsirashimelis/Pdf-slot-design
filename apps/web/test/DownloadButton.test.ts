import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DownloadButton } from '@/features/editor/toolbar/DownloadButton'

/**
 * How the file actually reaches the disk. A browser reads a blob: URL
 * asynchronously, so the two things this suite pins -- the anchor being in
 * the document when it is clicked, and the URL outliving that click -- are
 * what decide whether a download happens at all. Getting either wrong
 * fails silently: no file, no error, nothing in the console. It showed up
 * on a 109-page export (~1.2 MB out), where the read is slow enough for an
 * immediate revoke to abort it; a small fixture always won the race, which
 * is why the earlier tests never saw it.
 */

function setup(bytes = new Uint8Array([1, 2, 3])) {
  const createObjectURL = vi.fn((blob: unknown) => {
    void blob
    return 'blob:fake-url'
  })
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', class FakeURL extends URL {
    static createObjectURL = createObjectURL
    static revokeObjectURL = revokeObjectURL
  })
  vi.stubGlobal('Blob', class FakeBlob {
    parts: unknown[]
    constructor(parts: unknown[]) {
      this.parts = parts
    }
  })

  // The anchor the component creates, captured with its state at click time.
  const atClick: { connected: boolean | null; revoked: number } = { connected: null, revoked: 0 }
  const realCreateElement = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = realCreateElement(tag)
    if (tag === 'a') {
      el.click = vi.fn(() => {
        atClick.connected = el.isConnected
        atClick.revoked = revokeObjectURL.mock.calls.length
      })
    }
    return el
  })

  render(
    createElement(
      TooltipProvider,
      null,
      createElement(DownloadButton, {
        isRendering: false,
        render: vi.fn(async () => bytes),
        downloadBlockedReason: null,
        fileName: 'form.pdf',
      }),
    ),
  )
  return { atClick, createObjectURL, revokeObjectURL }
}

describe('DownloadButton saving', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    cleanup()
    // The anchor lives on <body>, outside React's container, and a test
    // that never advances the clock leaves its own behind.
    document.querySelectorAll('a[download]').forEach((el) => el.remove())
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('clicks an anchor that is in the document, and keeps the object URL alive past the click', async () => {
    const { atClick, createObjectURL, revokeObjectURL } = setup()

    fireEvent.click(screen.getByTestId('download-button'))
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(atClick.connected).not.toBeNull())

    // A detached anchor is ignored by some browsers, and revoking in the
    // same task as the click aborts a download the browser has not
    // finished reading yet.
    expect(atClick.connected).toBe(true)
    expect(atClick.revoked).toBe(0)
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })

  it('cleans up afterwards: the anchor leaves the document and the URL is revoked', async () => {
    const { createObjectURL, revokeObjectURL } = setup()

    fireEvent.click(screen.getByTestId('download-button'))
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1))
    expect(document.querySelectorAll('a[download]').length).toBe(1)

    await vi.advanceTimersByTimeAsync(60_000)

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url')
    expect(document.querySelectorAll('a[download]').length).toBe(0)
  })

  it('saves exactly the bytes the render resolved with, under the file\'s own name', async () => {
    const bytes = new Uint8Array([9, 9, 9])
    const { createObjectURL } = setup(bytes)

    fireEvent.click(screen.getByTestId('download-button'))
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1))

    const blob = createObjectURL.mock.calls[0]![0] as { parts: unknown[] }
    expect(blob.parts[0]).toBe(bytes)
    expect((document.querySelector('a[download]') as HTMLAnchorElement).download).toBe('form.pdf')
  })
})
