import { FONT_CSS_FAMILY, FONT_FILES, FONT_IDS, type FontBytes } from '@pdf-slot/core'

let cache: Promise<FontBytes> | null = null

/** Fetch all five faces once. The same bytes feed metrics, CSS and embedding. */
export function loadFontBytes(): Promise<FontBytes> {
  cache ??= (async () => {
    const entries = await Promise.all(
      FONT_IDS.map(async (id) => {
        const res = await fetch(`/fonts/${FONT_FILES[id]}`)
        if (!res.ok) throw new Error(`Failed to load font ${id}`)
        return [id, new Uint8Array(await res.arrayBuffer())] as const
      }),
    )
    return Object.fromEntries(entries) as FontBytes
  })()
  return cache
}

/** Register the very same bytes as CSS faces so the overlay cannot diverge. */
export async function registerFontFaces(bytes: FontBytes): Promise<void> {
  await Promise.all(
    FONT_IDS.map(async (id) => {
      const face = new FontFace(FONT_CSS_FAMILY[id], bytes[id].buffer as ArrayBuffer)
      await face.load()
      document.fonts.add(face)
    }),
  )
}
