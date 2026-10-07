// The mapping itself lives in core, shared with the editor's preview of a
// record: the two must agree to the letter, or what is previewed is not
// what is generated.
export { recordToValues } from '@pdf-slot/core'

export const itemFileName = (index: number) => `record-${String(index + 1).padStart(4, '0')}.pdf`
export const itemPath = (jobId: string, index: number) => `jobs/${jobId}/${itemFileName(index)}`
export const zipPath = (jobId: string) => `jobs/${jobId}/all.zip`
