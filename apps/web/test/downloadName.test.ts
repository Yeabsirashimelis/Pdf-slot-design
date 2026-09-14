import { describe, expect, it } from 'vitest'
import { downloadName } from '@/features/editor/toolbar/downloadName'

describe('downloadName', () => {
  it('keeps the original PDF name', () => {
    expect(downloadName('G702 application.pdf')).toBe('G702 application.pdf')
  })
  it('gives an image-derived name a .pdf extension', () => {
    expect(downloadName('scan.png')).toBe('scan.pdf')
    expect(downloadName('photo.JPEG')).toBe('photo.pdf')
  })
  it('falls back when there is no usable name', () => {
    expect(downloadName(undefined)).toBe('edited.pdf')
    expect(downloadName('   ')).toBe('edited.pdf')
    expect(downloadName('.pdf')).toBe('edited.pdf')
  })
  it('strips path separators a browser would refuse', () => {
    expect(downloadName('forms/2026/co.pdf')).toBe('forms-2026-co.pdf')
  })
})
