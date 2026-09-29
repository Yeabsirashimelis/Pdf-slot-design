import { describe, expect, it } from 'vitest'
import { checkColumns, noColumnsMatch, validateBeforeSubmit } from '@/features/generate/checkColumns'

const rows = (...columns: string[]) => [Object.fromEntries(columns.map((c) => [c, 'x']))]

/** Slots only: what a file with no table offers a record to fill. */
const slots = (...slotNames: string[]) => ({ slotNames, tables: [] })
/** Nothing matched and nothing carried rows: what the slot-only cases expect back. */
const noTables = { slotsFilled: [] as string[], tables: [], wrongKind: [] }

describe('checkColumns', () => {
  it('lists the columns of the first record, in order, and finds nothing wrong when they match', () => {
    expect(checkColumns(rows('Name', 'Date'), slots('Name', 'Date'))).toEqual({
      columns: ['Name', 'Date'], unknown: [], missing: [], suggestions: {},
      ...noTables, slotsFilled: ['Name', 'Date'],
    })
  })
  it('flags a column that matches no slot, and names the slot it is one typo away from', () => {
    expect(checkColumns(rows('Nmae'), slots('Name', 'Date'))).toEqual({
      columns: ['Nmae'], unknown: ['Nmae'], missing: ['Name', 'Date'], suggestions: { Nmae: 'Name' },
      ...noTables,
    })
  })
  it('offers no guess for a column that resembles no slot', () => {
    expect(checkColumns(rows('Name', 'Invoice reference'), slots('Name', 'Date'))).toEqual({
      columns: ['Name', 'Invoice reference'], unknown: ['Invoice reference'], missing: ['Date'], suggestions: {},
      ...noTables, slotsFilled: ['Name'],
    })
  })
  it('suggests the slot when only the case or the surrounding space differs', () => {
    expect(checkColumns(rows('name'), slots('Name')).suggestions).toEqual({ name: 'Name' })
    expect(checkColumns(rows(' Name'), slots('Name')).suggestions).toEqual({ ' Name': 'Name' })
    // Matching is exact everywhere else, so "name" is still an unknown column -- only the advice
    // about it changes.
    expect(checkColumns(rows('name'), slots('Name')).unknown).toEqual(['name'])
  })
  it('picks the nearest slot when more than one is close', () => {
    expect(checkColumns(rows('Dat'), slots('Date', 'Data point')).suggestions).toEqual({ Dat: 'Date' })
  })
  it('lists slots that no column fills', () => {
    expect(checkColumns(rows('Name'), slots('Name', 'Date', 'Amount')).missing).toEqual(['Date', 'Amount'])
  })
  it('says nothing at all when there are no records to compare', () => {
    expect(checkColumns([], slots('Name'))).toEqual({ columns: [], unknown: [], missing: [], suggestions: {}, ...noTables })
  })
})

describe('validateBeforeSubmit', () => {
  it('refuses when every column is unknown, even with a key', () => {
    expect(validateBeforeSubmit({ text: 'Full name,Day\nAbel,18 Sep\n', targets: slots('Name', 'Date'), apiKey: 'k' })).toEqual({
      error: 'None of these columns match your slots (Name, Date)',
    })
  })
  it('refuses a blank API key once the columns are fine', () => {
    expect(validateBeforeSubmit({ text: '[{"Name":"A"}]', targets: slots('Name'), apiKey: '  ' })).toEqual({
      error: 'Enter your API key',
    })
  })
  it('reports a parse error before either check runs', () => {
    expect(validateBeforeSubmit({ text: 'Name,Name\nAbel,Sara\n', targets: slots('Name'), apiKey: '' })).toEqual({
      error: 'Two columns are named "Name"',
    })
  })
  it('returns the records to send when the data and key both check out', () => {
    expect(validateBeforeSubmit({ text: '[{"Name":"A"},{"Name":"B"}]', targets: slots('Name'), apiKey: 'k' })).toEqual({
      records: [{ Name: 'A' }, { Name: 'B' }],
    })
  })
})

describe('a file with a table: slots, rows, or both, whatever matches', () => {
  /** A change-order log: two plain slots and a four-column table of three rows. */
  const log = {
    slotNames: ['Client', 'Issued'],
    tables: [{ name: 'Change orders', columns: ['No', 'Date', 'Description', 'Amount'], rowCount: 3 }],
  }
  const order = (no: string) => ({ No: no, Date: '03/14', Description: 'Doors', Amount: '10.00' })

  it('fills the slots when the record carries only text', () => {
    const check = checkColumns([{ Client: 'Abel', Issued: '18 Sep' }], log)
    expect(check.slotsFilled).toEqual(['Client', 'Issued'])
    expect(check.tables).toEqual([])
    // The table is printed blank rather than being a reason to refuse.
    expect(check.missing).toEqual(['Change orders'])
    expect(noColumnsMatch(check, log)).toBe(false)
  })

  it('fills the table when the record carries only rows', () => {
    const check = checkColumns([{ 'Change orders': [order('1'), order('2')] }], log)
    expect(check.slotsFilled).toEqual([])
    expect(check.tables).toHaveLength(1)
    expect(check.tables[0]!.unknown).toEqual([])
    expect(check.tables[0]!.extraRows).toBe(0)
    expect(check.missing).toEqual(['Client', 'Issued'])
    expect(noColumnsMatch(check, log)).toBe(false)
  })

  it('fills both from one record', () => {
    const check = checkColumns([{ Client: 'Abel', 'Change orders': [order('1')] }], log)
    expect(check.slotsFilled).toEqual(['Client'])
    expect(check.tables[0]!.name).toBe('Change orders')
    expect(check.unknown).toEqual([])
    expect(noColumnsMatch(check, log)).toBe(false)
  })

  it('names a mistyped column inside the table, and the column it meant', () => {
    const check = checkColumns([{ 'Change orders': [{ No: '1', Daet: '03/14' }] }], log)
    expect(check.tables[0]!.unknown).toEqual(['Daet'])
    expect(check.tables[0]!.suggestions).toEqual({ Daet: 'Date' })
    expect(check.tables[0]!.missing).toEqual(['Date', 'Description', 'Amount'])
  })

  it('counts the rows the table has no line for, across every record', () => {
    const check = checkColumns([
      { 'Change orders': [order('1')] },
      { 'Change orders': [order('1'), order('2'), order('3'), order('4'), order('5')] },
    ], log)
    expect(check.tables[0]!.extraRows).toBe(2)
  })

  it('says so when a slot was handed rows, or a table handed text', () => {
    const muddled = checkColumns([{ Client: [order('1')], 'Change orders': 'Doors' }], log)
    expect(muddled.wrongKind).toEqual([
      '"Client" is a slot, so it needs text, not a list of rows',
      '"Change orders" is a table, so it needs a list of rows, not text',
    ])
    // Both names were right, so neither is reported as an unknown column.
    expect(muddled.unknown).toEqual([])
    // But nothing is actually filled, so it must not generate.
    expect(noColumnsMatch(muddled, log)).toBe(true)
  })

  it('refuses a record that names the table and then gets every column wrong', () => {
    const check = checkColumns([{ 'Change orders': [{ a: '1', b: '2' }] }], log)
    expect(check.tables[0]!.unknown).toEqual(['a', 'b'])
    expect(noColumnsMatch(check, log)).toBe(true)
  })

  it('names the tables too when nothing matches at all', () => {
    expect(validateBeforeSubmit({ text: '[{"Nothing":"x"}]', targets: log, apiKey: 'k' })).toEqual({
      error: 'None of these columns match your slots or tables (Client, Issued, Change orders)',
    })
  })

  it('sends the rows through untouched when everything checks out', () => {
    const text = JSON.stringify([{ Client: 'Abel', 'Change orders': [order('1')] }])
    expect(validateBeforeSubmit({ text, targets: log, apiKey: 'k' })).toEqual({
      records: [{ Client: 'Abel', 'Change orders': [order('1')] }],
    })
  })
})
