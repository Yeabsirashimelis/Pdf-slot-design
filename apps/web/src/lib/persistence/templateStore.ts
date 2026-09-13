import type { FileId, StoredFile, TemplateLayout, TemplateValues } from '@pdf-slot/core'

export type Step = 'layout' | 'write'
export type OpenSession = { fileId: FileId; step: Step }

/**
 * Per-file persistence for the two-step editor. IndexedDB implements it
 * today (indexedDbTemplateStore.ts); the Hono backend will implement the
 * same six methods over HTTP. Nothing above this interface knows which.
 *
 * Contract: methods never reject. Storage being unavailable is normal
 * (private browsing, quota, policy) and must degrade to "nothing is
 * remembered", not a broken editor -- reads return null, writes are dropped.
 */
export interface TemplateStore {
  getFile(fileId: FileId): Promise<StoredFile | null>
  putFile(file: StoredFile): Promise<void>
  getLayout(fileId: FileId): Promise<TemplateLayout | null>
  putLayout(layout: TemplateLayout): Promise<void>
  getValues(fileId: FileId): Promise<TemplateValues | null>
  putValues(values: TemplateValues): Promise<void>
}

/** What is open right now -- so a reload lands the user back where they were. */
export interface SessionStore {
  get(): Promise<OpenSession | null>
  put(session: OpenSession): Promise<void>
  clear(): Promise<void>
}
