'use client'

import { useState, type KeyboardEvent } from 'react'
import { Input } from '@/components/ui/input'

/**
 * A numeric field that commits on Enter or blur (and steps with the arrow
 * keys), not on every keystroke -- typing "12" must not pass through a
 * size of 1. Built on shadcn's Input: the registry has no number field of
 * its own, and this is only a draft around one. Half-typed or out-of-range
 * input is dropped on commit and the field snaps back to the value.
 */
export function NumberField({
  value,
  onCommit,
  onPreview,
  min,
  max,
  step = 1,
  ...input
}: Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'min' | 'max' | 'step'> & {
  value: number
  onCommit(value: number): void
  /**
   * Called for each step of a held arrow, if given. A held key is one
   * gesture: it should show every number on the way but settle -- one
   * undo step, one re-render -- only when the key comes up.
   */
  onPreview?(value: number): void
  min: number
  max: number
  step?: number
}) {
  const [draft, setDraft] = useState<string | null>(null)

  const commit = () => {
    if (draft === null) return
    const parsed = Number(draft)
    setDraft(null)
    if (draft.trim() === '' || !Number.isFinite(parsed)) return
    const clamped = Math.min(max, Math.max(min, parsed))
    if (clamped !== value) onCommit(clamped)
  }

  /** The arrow let go: settle on whatever it stepped to. */
  const handleKeyUp = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!onPreview) return
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    commit()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
      event.currentTarget.blur()
    } else if (event.key === 'Escape') {
      setDraft(null)
      event.currentTarget.blur()
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const direction = event.key === 'ArrowUp' ? 1 : -1
      const size = event.shiftKey ? step * 10 : step
      // Step from what the field is showing, not from the value that came
      // down as a prop. A held key repeats faster than the prop comes
      // back, so stepping from the prop makes every repeat land on the
      // same number and the field appears to stick.
      const shown = draft !== null && Number.isFinite(Number(draft)) ? Number(draft) : value
      const next = Math.min(max, Math.max(min, shown + direction * size))
      setDraft(String(next))
      // Live while the key is down; `handleKeyUp` settles it. Committing
      // every repeat forced a synchronous render per keystroke, and a
      // held key never let React come up for air.
      if (onPreview) onPreview(next)
      else onCommit(next)
    }
  }

  return (
    <Input
      inputMode="decimal"
      value={draft ?? String(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      {...input}
    />
  )
}
