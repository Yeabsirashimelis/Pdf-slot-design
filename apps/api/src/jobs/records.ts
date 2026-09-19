import type { TemplateLayout } from '@pdf-slot/core'
import type { JobRecord } from '@pdf-slot/contracts'

/** A record is keyed by slot *name*; the renderer wants slot *id* -> text. Missing names stay blank, unknown keys are ignored. */
export function recordToValues(layout: TemplateLayout, record: JobRecord): Record<string, string> {
  const values: Record<string, string> = {}
  for (const slot of layout.slots) {
    const text = record[slot.name]
    if (text !== undefined && text !== '') values[slot.id] = text
  }
  return values
}

export const itemFileName = (index: number) => `record-${String(index + 1).padStart(4, '0')}.pdf`
export const itemPath = (jobId: string, index: number) => `jobs/${jobId}/${itemFileName(index)}`
export const zipPath = (jobId: string) => `jobs/${jobId}/all.zip`
