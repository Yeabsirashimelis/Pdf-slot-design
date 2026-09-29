import { describe, expect, it } from 'vitest'
import { cellId } from '@pdf-slot/core'
import { itemFileName, recordToValues } from '../src/jobs/records.js'
import { FILE_ID, slot } from './helpers/fixtures.js'

/** A change-order log: two plain slots and a two-column table of two rows. */
const table = {
  id: 't1', name: 'Change orders', page: 0, x: 40, y: 500,
  columns: [{ key: 'c1', name: 'No', width: 40 }, { key: 'c2', name: 'Amount', width: 80 }],
  rowHeights: [22, 22],
  style: { fontId: 'sans', size: 10, color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2 },
}
const withTable = { ...layoutBase(), tables: [table] } as never
function layoutBase() {
  return { fileId: FILE_ID, updatedAt: 't', slots: [slot(), slot({ id: 's2', name: 'Date', order: 1 })] }
}

const layout = layoutBase() as never

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

describe('records: a table is filled from the same record as the slots', () => {
  const rows = [{ No: '1', Amount: '10.00' }, { No: '2', Amount: '20.00' }]

  it('fills only the slots when the record carries only text', () => {
    expect(recordToValues(withTable, { Name: 'Abel' })).toEqual({ s1: 'Abel' })
  })

  it('fills only the table when the record carries only rows', () => {
    expect(recordToValues(withTable, { 'Change orders': rows })).toEqual({
      [cellId('t1', 0, 'c1')]: '1', [cellId('t1', 0, 'c2')]: '10.00',
      [cellId('t1', 1, 'c1')]: '2', [cellId('t1', 1, 'c2')]: '20.00',
    })
  })

  it('fills both from one record', () => {
    expect(recordToValues(withTable, { Name: 'Abel', 'Change orders': [rows[0]!] })).toEqual({
      s1: 'Abel', [cellId('t1', 0, 'c1')]: '1', [cellId('t1', 0, 'c2')]: '10.00',
    })
  })

  it('drops rows the table has no line for rather than printing off the form', () => {
    const tooMany = [...rows, { No: '3', Amount: '30.00' }]
    const values = recordToValues(withTable, { 'Change orders': tooMany })
    expect(values[cellId('t1', 1, 'c1')]).toBe('2')
    expect(values[cellId('t1', 2, 'c1')]).toBeUndefined()
  })

  it('passes over a list handed to a slot rather than printing "[object Object]"', () => {
    expect(recordToValues(withTable, { Name: rows, 'Change orders': [rows[0]!] })).toEqual({
      [cellId('t1', 0, 'c1')]: '1', [cellId('t1', 0, 'c2')]: '10.00',
    })
  })

  it('ignores rows for a table the file does not have', () => {
    expect(recordToValues(withTable, { Nothing: rows, Name: 'Abel' })).toEqual({ s1: 'Abel' })
  })
})
