import { describe, expect, it } from 'vitest'
import type { Slot } from '@pdf-slot/core'
import { groupByPage, readingOrder } from '@/features/template/readingOrder'

const slot = (id: string, page: number, x: number, y: number): Slot => ({
  id, page, x, y, width: 100, text: '', fontId: 'sans', size: 12,
  color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2,
})

describe('readingOrder', () => {
  it('sorts by page, then top-to-bottom (PDF y is up), then left-to-right', () => {
    const out = readingOrder([
      slot('p1-low', 1, 50, 100),
      slot('p0-right', 0, 300, 700),
      slot('p0-bottom', 0, 50, 200),
      slot('p0-left', 0, 50, 700),
    ])
    expect(out.map((s) => s.id)).toEqual(['p0-left', 'p0-right', 'p0-bottom', 'p1-low'])
  })

  it('treats slots within a few points vertically as one row', () => {
    // Two fields on the same printed line rarely share an exact y.
    const out = readingOrder([slot('b', 0, 300, 701), slot('a', 0, 50, 698)])
    expect(out.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('is stable for identical positions', () => {
    const out = readingOrder([slot('first', 0, 0, 0), slot('second', 0, 0, 0)])
    expect(out.map((s) => s.id)).toEqual(['first', 'second'])
  })
})

describe('groupByPage', () => {
  it('returns one group per page that has slots, in page order, each in reading order', () => {
    const groups = groupByPage([slot('c', 2, 0, 0), slot('a', 0, 0, 700), slot('b', 0, 0, 100)])
    expect(groups.map((g) => [g.page, g.slots.map((s) => s.id)])).toEqual([[0, ['a', 'b']], [2, ['c']]])
  })
})
