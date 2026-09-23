import { createElement } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShortcutsDialog, SHORTCUTS_KEY } from '@/features/editor/panels/ShortcutsDialog'

describe('ShortcutsDialog', () => {
  afterEach(() => cleanup())

  it('lists the commands with what each one does, not just the keys', async () => {
    render(createElement(ShortcutsDialog, { open: true, onOpenChange: vi.fn() }))
    const dialog = await waitFor(() => screen.getByTestId('shortcuts-dialog'))

    // Grouped, and every line says what the keys are for.
    for (const section of ['Slots', 'Tables', 'The page', 'The file']) {
      expect(dialog.textContent).toContain(section)
    }
    expect(dialog.textContent).toMatch(/Duplicate the selected slot/)
    expect(dialog.textContent).toMatch(/Cut it \u2014 the next paste puts it down again/)
    expect(dialog.textContent).toMatch(/Two-finger scroll moves the page/)
    expect(dialog.textContent).toMatch(/Rows you leave empty print nothing/)

    // And it says how to get back to itself.
    expect(dialog.textContent).toContain(SHORTCUTS_KEY)
    expect(dialog.querySelectorAll('kbd[data-slot="kbd"]').length).toBeGreaterThan(10)
  })

  it('shows nothing until it is opened', () => {
    render(createElement(ShortcutsDialog, { open: false, onOpenChange: vi.fn() }))
    expect(screen.queryByTestId('shortcuts-dialog')).toBeNull()
  })
})
