import type { FontId } from '../fonts/registry'
import type { Align } from '../layout/wrap'

export type RGB = { r: number; g: number; b: number }
export type PageSize = { width: number; height: number }

export type Slot = {
  id: string
  page: number
  /** Left edge of the box, PDF points, origin bottom-left. */
  x: number
  /** Top edge of the box, PDF points. Height is derived from layout. */
  y: number
  width: number
  text: string
  fontId: FontId
  size: number
  color: RGB
  align: Align
  lineHeight: number
}

export type EditorDocument = {
  id: string
  /** Always a PDF by this point, whatever the user uploaded. */
  source: Uint8Array
  pages: PageSize[]
}

export class InvalidPdfError extends Error {
  constructor() {
    super('This file is not a readable PDF.')
    this.name = 'InvalidPdfError'
  }
}

export class EncryptedPdfError extends Error {
  constructor() {
    super('This PDF is password-protected and cannot be edited.')
    this.name = 'EncryptedPdfError'
  }
}
