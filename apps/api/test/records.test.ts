import { describe, expect, it } from 'vitest'
import { itemFileName, recordToValues } from '../src/jobs/records.js'
import { FILE_ID, slot } from './helpers/fixtures.js'

const layout = { fileId: FILE_ID, updatedAt: 't', slots: [slot(), slot({ id: 's2', name: 'Date', order: 1 })] } as never

describe('records', () => {
  it('maps slot names to slot ids; missing names are blank; unknown keys are ignored', () => {
    expect(recordToValues(layout, { Name: 'Abel', Extra: 'x' })).toEqual({ s1: 'Abel' })
    expect(recordToValues(layout, { Name: 'Abel', Date: '18 Sep' })).toEqual({ s1: 'Abel', s2: '18 Sep' })
  })
  it('names files by 1-based, zero-padded index', () => {
    expect(itemFileName(0)).toBe('record-0001.pdf')
    expect(itemFileName(1234)).toBe('record-1235.pdf')
  })
})
