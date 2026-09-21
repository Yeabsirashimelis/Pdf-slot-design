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
  min,
  max,
  step = 1,
  ...input
}: Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'min' | 'max' | 'step'> & {
  value: number
  onCommit(value: number): void
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
      setDraft(null)
      onCommit(Math.min(max, Math.max(min, value + direction * size)))
    }
  }

  return (
    <Input
      inputMode="decimal"
      value={draft ?? String(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
      {...input}
    />
  )
}
