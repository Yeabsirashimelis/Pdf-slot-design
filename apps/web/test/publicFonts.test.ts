import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { FONT_FILES, FONT_IDS } from '@pdf-slot/core'

/**
 * The browser's copy of each face and the renderer's copy must be the same
 * file, byte for byte.
 *
 * This is the one place the preview/download guarantee rests on two files
 * agreeing rather than on one number matching another. The overlay measures
 * with what the browser fetched from `apps/web/public/fonts`; the exported
 * PDF is measured and drawn with what `packages/core/src/fonts/files` holds
 * (by way of the embedded module). Every other link in the chain is already
 * guarded -- packages/core's embedded-fonts test pins the embedded base64 to
 * core's TTFs, and apps/api's fonts test pins the renderer's bytes to the
 * same -- but nothing until now compared the copy the browser draws with.
 *
 * So a face updated in one directory and not the other would pass the whole
 * suite while the editor laid text out in one font and the download printed
 * another. The two fonts would be close enough that nothing would look
 * broken; lines would simply break in different places on screen than on the
 * page, which is the failure this project exists to prevent.
 */
const coreDir = path.resolve(__dirname, '../../../packages/core/src/fonts/files')
const webDir = path.resolve(__dirname, '../public/fonts')

describe('the fonts the browser fetches are the fonts the renderer embeds', () => {
  test.each(FONT_IDS)('%s is byte-identical in both directories', (id) => {
    const file = FONT_FILES[id]
    const served = readFileSync(path.join(webDir, file))
    const embedded = readFileSync(path.join(coreDir, file))
    const hint = `${file} differs between apps/web/public/fonts and packages/core/src/fonts/files -- copy the one file to both and re-run \`npm run fonts:embed\` from packages/core`
    expect(served.byteLength, hint).toBe(embedded.byteLength)
    expect(Buffer.compare(served, embedded), hint).toBe(0)
  })

  test('every id the registry names is actually served to the browser', () => {
    // A registry entry with no file under public/fonts is not a build error:
    // loadFontBytes() would 404 at runtime, in the browser, and the editor
    // would refuse to lay anything out.
    for (const id of FONT_IDS) {
      const file = path.join(webDir, FONT_FILES[id])
      expect(() => readFileSync(file), `${FONT_FILES[id]} is missing from apps/web/public/fonts`).not.toThrow()
    }
  })
})
