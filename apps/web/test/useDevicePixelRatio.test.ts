import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDevicePixelRatio } from '@/features/editor/canvas/useDevicePixelRatio'

/**
 * PageCanvas sizes its backing store from devicePixelRatio. That value
 * changes whenever the user zooms the *browser* (Ctrl +/-) or drags the
 * window to a display with different scaling -- and a canvas painted for
 * the old ratio is then stretched to fit, blurring the page. The hook
 * must therefore re-render on ratio changes, not just read it once.
 */
describe('useDevicePixelRatio', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads the current ratio and re-renders when it changes', () => {
    let ratio = 1
    const listeners = new Set<() => void>()
    vi.stubGlobal('devicePixelRatio', ratio)
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        addEventListener: (_: string, fn: () => void) => listeners.add(fn),
        removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
      })),
    )

    const { result, unmount } = renderHook(() => useDevicePixelRatio())
    expect(result.current).toBe(1)
    expect(listeners.size).toBe(1)

    ratio = 2
    vi.stubGlobal('devicePixelRatio', ratio)
    act(() => [...listeners].forEach((fn) => fn()))
    expect(result.current).toBe(2)
    // Re-subscribed for the new ratio's media query, old listener gone.
    expect(listeners.size).toBe(1)

    unmount()
    expect(listeners.size).toBe(0)
  })

  it('falls back to 1 without matchMedia (jsdom, old browsers)', () => {
    vi.stubGlobal('devicePixelRatio', undefined)
    vi.stubGlobal('matchMedia', undefined)
    const { result } = renderHook(() => useDevicePixelRatio())
    expect(result.current).toBe(1)
  })
})
