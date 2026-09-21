import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Slot } from '@pdf-slot/core'
import { InspectorPanel } from '@/features/editor/panels/InspectorPanel'
import { COLOR_SWATCHES } from '@/features/editor/panels/ColorField'

const slot: Slot = {
  id: 's1', page: 0, x: 10, y: 700, width: 200, text: '', fontId: 'sans', size: 14,
  color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2,
}

function renderPanel(extra: Partial<Parameters<typeof InspectorPanel>[0]> = {}) {
  const props = {
    selected: slot,
    name: 'Date',
    onRename: vi.fn(),
    applyPatch: vi.fn(),
    isRendering: false,
    render: vi.fn(async () => new Uint8Array([1])),
    downloadBlockedReason: null,
    onSave: vi.fn(),
    ...extra,
  }
  render(createElement(InspectorPanel, props))
  return props
}

describe('InspectorPanel', () => {
  afterEach(() => cleanup())

  it('disables every control with nothing selected, and when the layout is locked', () => {
    renderPanel({ selected: null, name: '' })
    expect((screen.getByTestId('inspector-name') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByTestId('font-select-trigger') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('size-input') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByTestId('color-hex') as HTMLInputElement).disabled).toBe(true)
    cleanup()
    renderPanel({ locked: true })
    expect((screen.getByTestId('font-select-trigger') as HTMLButtonElement).disabled).toBe(true)
    // The name is still editable under a lock: it is a label, not layout.
    expect((screen.getByTestId('inspector-name') as HTMLInputElement).disabled).toBe(false)
  })

  it('shows the selected slot as a family and a weight, and maps a change back to one FontId', async () => {
    const p = renderPanel({ selected: { ...slot, fontId: 'serif-bold' } })
    expect(screen.getByTestId('font-select-trigger').textContent).toContain('Serif')
    expect(screen.getByTestId('weight-select-trigger').textContent).toContain('Bold')

    fireEvent.click(screen.getByTestId('font-select-trigger'))
    const mono = await waitFor(() => screen.getByTestId('font-option-mono'))
    fireEvent.pointerDown(mono)
    fireEvent.click(mono)
    // Mono has no bold: the weight falls back to regular.
    await waitFor(() => expect(p.applyPatch).toHaveBeenCalledWith({ fontId: 'mono' }))
  }, 20000)

  it('the weight control is disabled for a family with one weight', () => {
    renderPanel({ selected: { ...slot, fontId: 'mono' } })
    expect((screen.getByTestId('weight-select-trigger') as HTMLButtonElement).disabled).toBe(true)
  })

  it('size and line height commit on Enter or blur, clamped, never per keystroke; arrows step', () => {
    const p = renderPanel()
    const size = screen.getByTestId('size-input') as HTMLInputElement
    expect(size.value).toBe('14')
    fireEvent.change(size, { target: { value: '1' } })
    fireEvent.change(size, { target: { value: '12' } })
    expect(p.applyPatch).not.toHaveBeenCalled()
    fireEvent.keyDown(size, { key: 'Enter' })
    expect(p.applyPatch).toHaveBeenLastCalledWith({ size: 12 })

    fireEvent.change(size, { target: { value: '9999' } })
    fireEvent.blur(size)
    expect(p.applyPatch).toHaveBeenLastCalledWith({ size: 200 })

    fireEvent.keyDown(size, { key: 'ArrowUp', shiftKey: true })
    expect(p.applyPatch).toHaveBeenLastCalledWith({ size: 24 })

    const lineHeight = screen.getByTestId('line-height-input') as HTMLInputElement
    fireEvent.change(lineHeight, { target: { value: '1.5' } })
    fireEvent.keyDown(lineHeight, { key: 'Enter' })
    expect(p.applyPatch).toHaveBeenLastCalledWith({ lineHeight: 1.5 })
  })

  it('alignment reports the new value and ignores an attempted deselect', () => {
    const p = renderPanel()
    fireEvent.click(screen.getByTestId('align-center'))
    expect(p.applyPatch).toHaveBeenLastCalledWith({ align: 'center' })
    fireEvent.click(screen.getByTestId('align-left'))
    expect(p.applyPatch).toHaveBeenCalledTimes(1)
  })

  it('colour: prints the hex, parses a typed one, and every swatch is 0-1 RGB', async () => {
    const p = renderPanel()
    const hex = screen.getByTestId('color-hex') as HTMLInputElement
    expect(hex.value).toBe('000000')
    fireEvent.change(hex, { target: { value: '#DC2626' } })
    fireEvent.keyDown(hex, { key: 'Enter' })
    expect(p.applyPatch).toHaveBeenLastCalledWith({ color: { r: 220 / 255, g: 38 / 255, b: 38 / 255 } })

    fireEvent.change(hex, { target: { value: 'nope' } })
    fireEvent.blur(hex)
    expect(p.applyPatch).toHaveBeenCalledTimes(1)
    expect(hex.value).toBe('000000')

    for (const swatch of COLOR_SWATCHES) {
      for (const channel of [swatch.color.r, swatch.color.g, swatch.color.b]) {
        expect(channel).toBeGreaterThanOrEqual(0)
        expect(channel).toBeLessThanOrEqual(1)
      }
    }
    fireEvent.click(screen.getByTestId('color-trigger'))
    const blue = await waitFor(() => screen.getByTestId('color-swatch-blue'))
    fireEvent.click(blue)
    expect(p.applyPatch).toHaveBeenLastCalledWith({ color: COLOR_SWATCHES.find((s) => s.label === 'Blue')!.color })
  })

  it('the name commits trimmed on Enter/blur, reverts on Escape, refuses empty', () => {
    const p = renderPanel()
    const name = screen.getByTestId('inspector-name') as HTMLInputElement
    expect(name.value).toBe('Date')
    fireEvent.change(name, { target: { value: '  Due date ' } })
    fireEvent.keyDown(name, { key: 'Enter' })
    expect(p.onRename).toHaveBeenCalledWith('Due date')
    fireEvent.change(name, { target: { value: '' } })
    fireEvent.blur(name)
    fireEvent.change(name, { target: { value: 'x' } })
    fireEvent.keyDown(name, { key: 'Escape' })
    expect(p.onRename).toHaveBeenCalledTimes(1)
  })

  it('Save and Download sit on top; Download is aria-disabled with the reason while blocked', () => {
    const p = renderPanel({ downloadBlockedReason: "The selected font can't draw 日." })
    fireEvent.click(screen.getByTestId('panel-save'))
    expect(p.onSave).toHaveBeenCalledTimes(1)
    const download = screen.getByTestId('download-button')
    expect(download.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(download)
    expect(p.render).not.toHaveBeenCalled()
  })
})
