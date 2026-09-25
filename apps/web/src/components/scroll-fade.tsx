// Hand-rolled rather than shadcn: shadcn's ScrollArea gives the
// scrolling and the scrollbar, but nothing in the kit says "there is
// more above/below this". That edge is a few lines of gradient over the
// top and bottom of a list, shown only while there is something in that
// direction to reach. See CLAUDE.md.
'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

/** Within this many pixels of an end, that end counts as reached. */
const EDGE_SLOP_PX = 2

/**
 * A list that scrolls, with the top and bottom fading out while there is
 * more of it in that direction.
 *
 * A list cut off by a hard edge reads as a list that has ended. The fade
 * says the opposite -- keep going -- and it goes away at the ends, so it
 * never suggests content that is not there.
 */
export function ScrollFade({
  children,
  className,
  'data-testid': testId,
}: {
  children?: ReactNode
  /** The scrolling box: give it the height you want it capped at. */
  className?: string
  'data-testid'?: string
}) {
  const root = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ above: false, below: false })

  const measure = useCallback((viewport: HTMLElement) => {
    const { scrollTop, scrollHeight, clientHeight } = viewport
    const above = scrollTop > EDGE_SLOP_PX
    const below = scrollTop + clientHeight < scrollHeight - EDGE_SLOP_PX
    // Keep the old object when the answer has not changed. A fresh one
    // every time is a state change every time, and this is called from an
    // effect: that is a render loop with nothing to stop it.
    setEdges((was) => (was.above === above && was.below === below ? was : { above, below }))
  }, [])

  useEffect(() => {
    const viewport = root.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
    if (!viewport) return
    measure(viewport)
    const onScroll = () => measure(viewport)
    viewport.addEventListener('scroll', onScroll, { passive: true })
    // Rows come and go, so the ends move without anyone scrolling.
    // Guarded: a test environment need not have ResizeObserver, and a
    // list that only re-measures on scroll is still a working list.
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure(viewport))
    if (observer) {
      observer.observe(viewport)
      // The content, not each row: rows come and go, and a list of them
      // measured once at mount would stop being the list being watched.
      const content = viewport.firstElementChild
      if (content) observer.observe(content)
    }
    return () => {
      viewport.removeEventListener('scroll', onScroll)
      observer?.disconnect()
    }
    // Deliberately not keyed on `children`: that is a new object on every
    // render, so the effect would re-run, measure, set state and render
    // again, for ever. The observer above is what notices the list
    // changing.
  }, [measure])

  return (
    <div ref={root} className="relative min-h-0" data-testid={testId}>
      <ScrollArea className={className}>{children}</ScrollArea>
      <div
        aria-hidden
        data-testid={testId ? `${testId}-fade-top` : undefined}
        data-visible={edges.above ? '' : undefined}
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-6 opacity-0 transition-opacity',
          'bg-gradient-to-b from-card to-transparent',
          edges.above && 'opacity-100',
        )}
      />
      <div
        aria-hidden
        data-testid={testId ? `${testId}-fade-bottom` : undefined}
        data-visible={edges.below ? '' : undefined}
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 h-6 opacity-0 transition-opacity',
          'bg-gradient-to-t from-card to-transparent',
          edges.below && 'opacity-100',
        )}
      />
    </div>
  )
}
