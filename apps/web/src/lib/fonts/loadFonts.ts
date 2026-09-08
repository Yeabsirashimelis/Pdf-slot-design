import { FONT_CSS_FAMILY, FONT_FILES, FONT_IDS, type FontBytes } from '@pdf-slot/core'

let cache: Promise<FontBytes> | null = null

/**
 * Fetch all five faces once. The same bytes feed metrics, CSS and embedding.
 *
 * `cache` is assigned synchronously (before the IIFE's first `await` yields),
 * so concurrent callers always share the same in-flight promise. On
 * rejection the cache is reset to `null` so a transient failure (a 404
 * during a deploy race, a flaky network blip) doesn't poison every future
 * call for the rest of the page's lifetime -- the next caller gets a fresh
 * attempt instead of the same stale rejection.
 */
export function loadFontBytes(): Promise<FontBytes> {
  cache ??= (async () => {
    try {
      const entries = await Promise.all(
        FONT_IDS.map(async (id) => {
          const res = await fetch(`/fonts/${FONT_FILES[id]}`)
          if (!res.ok) throw new Error(`Failed to load font ${id}`)
          return [id, new Uint8Array(await res.arrayBuffer())] as const
        }),
      )
      return Object.fromEntries(entries) as FontBytes
    } catch (err) {
      cache = null
      throw err
    }
  })()
  return cache
}

/** Register the very same bytes as CSS faces so the overlay cannot diverge. */
export async function registerFontFaces(bytes: FontBytes): Promise<void> {
  await Promise.all(
    FONT_IDS.map(async (id) => {
      const view = bytes[id]
      // Slice explicitly rather than passing `view.buffer` directly: `.buffer`
      // is only safe today because loadFontBytes() builds each Uint8Array
      // from a whole ArrayBuffer (`new Uint8Array(await res.arrayBuffer())`).
      // Nothing enforces that -- a Uint8Array backed by a larger, shared, or
      // offset buffer would make `.buffer` silently hand FontFace the wrong
      // bytes (ignoring byteOffset/byteLength). Slicing makes the exact
      // bytes structural instead of incidental.
      const source = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)
      // The cast is still needed, and is narrower than it looks: FontBytes is
      // declared as Record<FontId, Uint8Array> in packages/core, and that
      // Uint8Array's generic backing-buffer parameter defaults to
      // ArrayBufferLike (ArrayBuffer | SharedArrayBuffer), so `.slice()`
      // above types as the same union even though nothing here can ever
      // produce a SharedArrayBuffer -- every FontBytes value in this
      // codebase is built via `new Uint8Array(...)`, which always allocates
      // a fresh, whole, non-shared ArrayBuffer. Narrowing FontBytes itself
      // to Uint8Array<ArrayBuffer> would remove this cast, but that touches
      // a type shared by three consumers across packages/core and is out of
      // scope for this fix.
      const face = new FontFace(FONT_CSS_FAMILY[id], source as ArrayBuffer)
      await face.load()
      document.fonts.add(face)
    }),
  )
}
