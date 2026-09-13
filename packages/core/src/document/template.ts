import type { PageSize, Slot } from './types'

/** Hex SHA-256 of the uploaded PDF's bytes: how a file is recognised on re-upload. */
export type FileId = string

/**
 * A slot as saved with a file's layout (step 1): everything about a `Slot`
 * except its text, plus the name shown in the side panel and its position
 * there. The editor itself never sees names -- it works on `Slot[]`, and
 * the conversions below run at the persistence boundary.
 */
export type TemplateSlot = Omit<Slot, 'text'> & { name: string; order: number }

export type TemplateLayout = { fileId: FileId; slots: TemplateSlot[]; updatedAt: string }

/** What was written into the slots (step 2), keyed by slot id. Empty text is not stored. */
export type TemplateValues = { fileId: FileId; values: Record<string, string>; updatedAt: string }

export type StoredFile = {
  fileId: FileId
  name: string
  source: Uint8Array
  pages: PageSize[]
  createdAt: string
}

export function toSlots(layout: TemplateLayout, values?: TemplateValues | null): Slot[] {
  return [...layout.slots]
    .sort((a, b) => a.order - b.order)
    .map(({ name: _name, order: _order, ...slot }) => ({ ...slot, text: values?.values[slot.id] ?? '' }))
}

export function toLayout(
  fileId: FileId, slots: Slot[], names: Record<string, string>, updatedAt: string,
): TemplateLayout {
  return {
    fileId,
    updatedAt,
    slots: slots.map(({ text: _text, ...slot }, index) => ({
      ...slot,
      name: names[slot.id] ?? `Slot ${index + 1}`,
      order: index,
    })),
  }
}

export function toValues(fileId: FileId, slots: Slot[], updatedAt: string): TemplateValues {
  const values: Record<string, string> = {}
  for (const slot of slots) if (slot.text !== '') values[slot.id] = slot.text
  return { fileId, values, updatedAt }
}
