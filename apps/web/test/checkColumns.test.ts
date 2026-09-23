import { describe, expect, it } from 'vitest'
import { checkColumns, validateBeforeSubmit } from '@/features/generate/checkColumns'

const rows = (...columns: string[]) => [Object.fromEntries(columns.map((c) => [c, 'x']))]

describe('checkColumns', () => {
  it('lists the columns of the first record, in order, and finds nothing wrong when they match', () => {
    expect(checkColumns(rows('Name', 'Date'), ['Name', 'Date'])).toEqual({
      columns: ['Name', 'Date'], unknown: [], missing: [], suggestions: {},
    })
  })
  it('flags a column that matches no slot, and names the slot it is one typo away from', () => {
    expect(checkColumns(rows('Nmae'), ['Name', 'Date'])).toEqual({
      columns: ['Nmae'], unknown: ['Nmae'], missing: ['Name', 'Date'], suggestions: { Nmae: 'Name' },
    })
  })
  it('offers no guess for a column that resembles no slot', () => {
    expect(checkColumns(rows('Name', 'Invoice reference'), ['Name', 'Date'])).toEqual({
      columns: ['Name', 'Invoice reference'], unknown: ['Invoice reference'], missing: ['Date'], suggestions: {},
    })
  })
  it('suggests the slot when only the case or the surrounding space differs', () => {
    expect(checkColumns(rows('name'), ['Name']).suggestions).toEqual({ name: 'Name' })
    expect(checkColumns(rows(' Name'), ['Name']).suggestions).toEqual({ ' Name': 'Name' })
    // Matching is exact everywhere else, so "name" is still an unknown column -- only the advice
    // about it changes.
    expect(checkColumns(rows('name'), ['Name']).unknown).toEqual(['name'])
  })
  it('picks the nearest slot when more than one is close', () => {
    expect(checkColumns(rows('Dat'), ['Date', 'Data point']).suggestions).toEqual({ Dat: 'Date' })
  })
  it('lists slots that no column fills', () => {
    expect(checkColumns(rows('Name'), ['Name', 'Date', 'Amount']).missing).toEqual(['Date', 'Amount'])
  })
  it('says nothing at all when there are no records to compare', () => {
    expect(checkColumns([], ['Name'])).toEqual({ columns: [], unknown: [], missing: [], suggestions: {} })
  })
})

describe('validateBeforeSubmit', () => {
  it('refuses when every column is unknown, even with a key', () => {
    expect(validateBeforeSubmit({ text: 'Full name,Day\nAbel,18 Sep\n', slotNames: ['Name', 'Date'], apiKey: 'k' })).toEqual({
      error: 'None of these columns match your slots (Name, Date)',
    })
  })
  it('refuses a blank API key once the columns are fine', () => {
    expect(validateBeforeSubmit({ text: '[{"Name":"A"}]', slotNames: ['Name'], apiKey: '  ' })).toEqual({
      error: 'Enter your API key',
    })
  })
  it('reports a parse error before either check runs', () => {
    expect(validateBeforeSubmit({ text: 'Name,Name\nAbel,Sara\n', slotNames: ['Name'], apiKey: '' })).toEqual({
      error: 'Two columns are named "Name"',
    })
  })
  it('returns the records to send when the data and key both check out', () => {
    expect(validateBeforeSubmit({ text: '[{"Name":"A"},{"Name":"B"}]', slotNames: ['Name'], apiKey: 'k' })).toEqual({
      records: [{ Name: 'A' }, { Name: 'B' }],
    })
  })
})
