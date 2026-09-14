
/**
 * Slots within this many PDF points vertically count as one row: two
 * fields on the same printed line rarely share an exact y.
 */
const ROW_TOLERANCE_PT = 6

/**
 * The order a reader meets the slots: page by page, top to bottom, left
 * to right. Stable, so equal positions keep their insertion order. Used
 * for the panel's chips and the write step's fields (and so for Tab).
 */
export type Placed = { page: number; x: number; y: number }

export function readingOrder<T extends Placed>(slots: readonly T[]): T[] {
  return slots
    .map((slot, index) => ({ slot, index }))
    .sort((a, b) => {
      if (a.slot.page !== b.slot.page) return a.slot.page - b.slot.page
      // PDF y grows upward: a larger y is higher on the page, so it reads first.
      const dy = b.slot.y - a.slot.y
      if (Math.abs(dy) > ROW_TOLERANCE_PT) return dy
      if (a.slot.x !== b.slot.x) return a.slot.x - b.slot.x
      return a.index - b.index
    })
    .map(({ slot }) => slot)
}

export type PageGroup<T extends Placed> = { page: number; slots: T[] }

/** Reading-ordered slots, grouped by page; pages with no slots are omitted. */
export function groupByPage<T extends Placed>(slots: readonly T[]): PageGroup<T>[] {
  const groups: PageGroup<T>[] = []
  for (const slot of readingOrder(slots)) {
    const last = groups[groups.length - 1]
    if (last && last.page === slot.page) last.slots.push(slot)
    else groups.push({ page: slot.page, slots: [slot] })
  }
  return groups
}
