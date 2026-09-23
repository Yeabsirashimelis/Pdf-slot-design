'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Kbd, KbdGroup } from '@/components/ui/kbd'

/** One line of the list: the keys, and what they do. */
type Shortcut = { keys: string[][]; what: string }
type Section = { title: string; shortcuts: Shortcut[] }

/**
 * Every command the editor answers to, with what it does -- the list the
 * panel used to carry as a paragraph of small print. It belongs behind a
 * key rather than in the way: a person needs it twice and then never
 * again.
 */
const SECTIONS: Section[] = [
  {
    title: 'Slots',
    shortcuts: [
      { keys: [], what: 'Click the page to add a slot, name it, then type its text' },
      { keys: [['Ctrl', 'D']], what: 'Duplicate the selected slot' },
      { keys: [['Ctrl', 'C']], what: 'Copy it' },
      { keys: [['Ctrl', 'X']], what: 'Cut it \u2014 the next paste puts it down again' },
      { keys: [['Ctrl', 'V']], what: 'Paste under the pointer' },
      { keys: [['Alt'], ['drag']], what: 'Drag a copy, leaving the original' },
      { keys: [['Del']], what: 'Remove the selected slot' },
      { keys: [['Esc']], what: 'Deselect' },
      { keys: [['←'], ['→'], ['↑'], ['↓']], what: 'Nudge by 1pt, or 10pt with Shift' },
      { keys: [], what: 'Drag a slot by its name tag; the box itself is for its text' },
    ],
  },
  {
    title: 'Tables',
    shortcuts: [
      { keys: [], what: 'The table button draws one row; split it into columns and add rows' },
      { keys: [], what: 'Drag a column divider for that column\u2019s width' },
      { keys: [], what: 'Drag the right edge, the bottom edge or the corner to size the whole table' },
      { keys: [], what: 'The two handles down the left set the row height and the gap to the next row' },
      { keys: [], what: 'Every handle says what it does when you point at it' },
      { keys: [], what: 'Rows you leave empty print nothing' },
    ],
  },
  {
    title: 'The page',
    shortcuts: [
      { keys: [['Ctrl', 'scroll']], what: 'Zoom around the pointer (or pinch)' },
      { keys: [], what: 'Two-finger scroll moves the page' },
      { keys: [['Space'], ['drag']], what: 'Move the page from anywhere, slots included' },
      { keys: [['Ctrl', '+']], what: 'Zoom in' },
      { keys: [['Ctrl', '−']], what: 'Zoom out' },
      { keys: [['Ctrl', '0']], what: 'Fit the page' },
    ],
  },
  {
    title: 'The file',
    shortcuts: [
      { keys: [['Ctrl', 'Z']], what: 'Undo' },
      { keys: [['Ctrl', 'Shift', 'Z']], what: 'Redo' },
      { keys: [], what: 'Save keeps the layout and what you typed; Download writes the PDF' },
    ],
  },
]

/** The key that opens this list, quoted wherever the editor offers it. */
export const SHORTCUTS_KEY = '?'

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="shortcuts-dialog">
        <DialogHeader>
          <DialogTitle>Shortcuts</DialogTitle>
          <DialogDescription>
            Press <Kbd>{SHORTCUTS_KEY}</Kbd> any time to bring this back.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto pr-1">
          {SECTIONS.map((section) => (
            <section key={section.title} className="mb-4 last:mb-0">
              <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">{section.title}</h3>
              <dl className="flex flex-col gap-1.5">
                {section.shortcuts.map((shortcut) => (
                  <div key={shortcut.what} className="flex items-baseline gap-3">
                    <dt className="flex w-32 shrink-0 flex-wrap items-center gap-1">
                      {shortcut.keys.map((group, index) => (
                        <KbdGroup key={index}>
                          {group.map((key) => (
                            <Kbd key={key}>{key}</Kbd>
                          ))}
                        </KbdGroup>
                      ))}
                    </dt>
                    <dd className="min-w-0 flex-1 text-sm text-muted-foreground">{shortcut.what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
