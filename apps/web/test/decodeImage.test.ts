import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodeImage } from '../src/features/upload/decodeImage'

/**
 * jsdom implements neither `createImageBitmap` (undefined globally) nor a
 * real 2d canvas backend (`getContext('2d')` resolves to `null`, and
 * `toBlob` is a documented no-op that never invokes its callback -- see
 * https://github.com/jsdom/jsdom#canvas-support). Both are stubbed by hand
 * below rather than pulling in the `canvas` native package, and each stub
 * is asserted against directly (e.g. `drawImage` was called with the
 * decoded bitmap) so the test fails if decodeImage stops doing real work.
 */

function stubToBlob(blob: Blob | null) {
  return vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
    callback(blob)
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('decodeImage', () => {
  it('draws the decoded bitmap onto a canvas sized to it, and returns its PNG bytes', async () => {
    const bitmap = { width: 40, height: 20 }
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => bitmap),
    )

    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D)

    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    stubToBlob(new Blob([pngBytes]))

    const file = new File([new Uint8Array([0])], 'photo.webp', { type: 'image/webp' })
    const result = await decodeImage(file)

    // The specific bitmap decoded, not just "some object", was drawn.
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0)
    expect(result.format).toBe('png')
    expect(result.width).toBe(40)
    expect(result.height).toBe(20)
    expect(Array.from(result.bytes)).toEqual(Array.from(pngBytes))
  })

  it('rejects with a clear message when the browser cannot decode the format', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new Error('unsupported')
      }),
    )

    const file = new File([new Uint8Array([0])], 'photo.heic', { type: 'image/heic' })
    await expect(decodeImage(file)).rejects.toThrow(
      'This browser cannot read that image format.',
    )
  })

  it('rejects when a 2d canvas context is unavailable', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 1, height: 1 })),
    )
    // Not mocked: jsdom's own getContext('2d') already returns null.

    const file = new File([new Uint8Array([0])], 'photo.png', { type: 'image/png' })
    await expect(decodeImage(file)).rejects.toThrow(
      'Could not create a canvas to read the image.',
    )
  })

  it('rejects when the canvas cannot produce a blob', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 1, height: 1 })),
    )
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    stubToBlob(null)

    const file = new File([new Uint8Array([0])], 'photo.png', { type: 'image/png' })
    await expect(decodeImage(file)).rejects.toThrow('Could not convert the image.')
  })
})
