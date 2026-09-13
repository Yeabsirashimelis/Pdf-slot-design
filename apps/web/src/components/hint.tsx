'use client'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * A faint hover hint (shadcn Tooltip) for any control. Two shapes:
 *
 * - `<Hint label="…">…</Hint>` wraps a control that already owns its click
 *   (a Select, a Popover trigger, a ToggleGroup item) in a neutral inline
 *   trigger, so two base-ui triggers never fight over one element.
 * - `<HintButton hint="…" …buttonProps />` is a shadcn Button that is its
 *   own trigger -- the common case for plain buttons.
 *
 * Both need a `TooltipProvider` above them. Composition only: the tooltip
 * styling itself lives in components/ui/tooltip.tsx.
 */
export function Hint({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function HintButton({ hint, ...button }: { hint: React.ReactNode } & React.ComponentProps<typeof Button>) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button {...button} />} />
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  )
}
