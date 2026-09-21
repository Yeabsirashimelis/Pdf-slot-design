import type { RGB } from '@pdf-slot/core'

/**
 * The inspector's colour field speaks hex (`000000`, as Figma prints it);
 * the document model stores 0–1 components (see `RGB`). These are the two
 * conversions, and the only place `255` appears on the panel side.
 */
export function rgbToHex(color: RGB): string {
  const byte = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0')
  return `${byte(color.r)}${byte(color.g)}${byte(color.b)}`
}

/** Accepts `rrggbb`, `#rrggbb`, `rgb` and `#rgb`, any case; null for anything else. */
export function hexToRgb(hex: string): RGB | null {
  const raw = hex.trim().replace(/^#/, '')
  const full = /^[0-9a-f]{6}$/i.test(raw) ? raw : /^[0-9a-f]{3}$/i.test(raw) ? raw.replace(/./g, '$&$&') : null
  if (!full) return null
  return {
    r: parseInt(full.slice(0, 2), 16) / 255,
    g: parseInt(full.slice(2, 4), 16) / 255,
    b: parseInt(full.slice(4, 6), 16) / 255,
  }
}
