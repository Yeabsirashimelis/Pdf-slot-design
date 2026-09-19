'use client'

import { useState, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Asked at placement in step 1 (and on rename): every template slot has a
 * name, because the write step's side panel is a form and each field needs
 * a label. A shadcn Dialog rather than a click-anchored popover -- the
 * installed Popover wrapper exposes no anchor, and a modal needs no
 * positioning. Empty (after trimming) is refused; Esc/Cancel places nothing.
 */
export function NameSlotDialog({
  open, initialName = '', taken = [], onSubmit, onCancel,
}: {
  open: boolean
  initialName?: string
  taken?: readonly string[]
  onSubmit(name: string): void
  onCancel(): void
}) {
  const [name, setName] = useState(initialName)
  // Reset the field whenever the dialog transitions to open, without a
  // useEffect: adjusting state during render (rather than after commit)
  // avoids the extra render pass react-hooks flags for setState-in-effect.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setName(initialName)
  }

  const trimmedName = name.trim()
  const isTaken = taken.includes(trimmedName)

  const submit = () => {
    const trimmed = name.trim()
    if (trimmed === '' || isTaken) return
    onSubmit(trimmed)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      submit()
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{initialName ? 'Rename slot' : 'Name this slot'}</DialogTitle>
          <DialogDescription>The name labels this field when the form is filled in.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="slot-name">Name</Label>
          <Input
            id="slot-name"
            data-testid="slot-name-input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Date"
          />
          {isTaken && (
            <p className="text-xs text-destructive" data-testid="slot-name-taken">
              A slot named &ldquo;{trimmedName}&rdquo; already exists on this file. Names must be unique.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} data-testid="slot-name-cancel">Cancel</Button>
          <Button onClick={submit} disabled={trimmedName === '' || isTaken} data-testid="slot-name-submit">
            {initialName ? 'Rename' : 'Add slot'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
