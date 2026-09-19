import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { FONT_FILES, FONT_IDS, type FontBytes } from '@pdf-slot/core'

/** Where font bytes come from: disk in tests/dev, Nitro server assets in production (see runtime.ts). */
export type FontSource = (fileName: string) => Promise<Uint8Array>

export const diskFontSource = (dir: string): FontSource => (name) => readFile(path.join(dir, name)).then((b) => new Uint8Array(b))

export async function loadFonts(source: FontSource): Promise<FontBytes> {
  const entries = await Promise.all(FONT_IDS.map(async (id) => [id, await source(FONT_FILES[id])] as const))
  return Object.fromEntries(entries) as FontBytes
}
