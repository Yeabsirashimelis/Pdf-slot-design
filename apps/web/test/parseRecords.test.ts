import { describe, expect, it } from 'vitest'
import { MAX_JOB_RECORDS } from '@pdf-slot/contracts'
import { parseRecords } from '@/features/generate/parseRecords'

describe('parseRecords', () => {
  it('accepts a JSON array of string objects', () => {
    expect(parseRecords('[{"Name":"Abel"},{"Name":"Sara"}]')).toEqual({ records: [{ Name: 'Abel' }, { Name: 'Sara' }] })
    expect(parseRecords('{"Name":"Abel"}')).toEqual({ error: 'Expected a JSON array of objects' })
  })
  it('accepts CSV with a header row, quotes, commas and CRLF', () => {
    expect(parseRecords('Name,Date\r\n"Tesfaye, Abel",18 Sep\r\nSara,"say ""hi"""\r\n')).toEqual({
      records: [{ Name: 'Tesfaye, Abel', Date: '18 Sep' }, { Name: 'Sara', Date: 'say "hi"' }],
    })
    expect(parseRecords('Name\n')).toEqual({ error: 'No rows found under the header' })
  })
  it('strips a UTF-8 byte-order mark from the start of a CSV, so the first header names the slot', () => {
    // Excel and Windows editors prefix UTF-8 CSV with U+FEFF; left in, the first column would be
    // keyed "\uFEFFName" and never match a slot named "Name".
    expect(parseRecords('\uFEFFName,Date\nAbel,18 Sep\n')).toEqual({ records: [{ Name: 'Abel', Date: '18 Sep' }] })
    expect(parseRecords('\uFEFF[{"Name":"Abel"}]')).toEqual({ records: [{ Name: 'Abel' }] })
    expect(parseRecords('')).toEqual({ error: 'Paste a JSON array or CSV' })
    expect(parseRecords('just a sentence')).toEqual({ error: 'Paste a JSON array or CSV' })
  })
  it('trims the header names but leaves the values exactly as typed', () => {
    expect(parseRecords(' Name , Date \n  Abel  ,18 Sep\n')).toEqual({ records: [{ Name: '  Abel  ', Date: '18 Sep' }] })
  })
  it('reads a one-column CSV, where there is no delimiter to detect', () => {
    expect(parseRecords('Name\nAbel\nSara\n')).toEqual({ records: [{ Name: 'Abel' }, { Name: 'Sara' }] })
  })
  it('names the offending row when a row has the wrong number of fields', () => {
    expect(parseRecords('Name,Date\nAbel\n')).toEqual({ error: 'Row 1: too few fields' })
    expect(parseRecords('Name\nAbel,18 Sep\n')).toEqual({ error: 'Row 1: too many fields' })
  })
  it('reports at most three bad rows, then how many more there are', () => {
    expect(parseRecords('Name,Date\na\nb,c\nd\ne\nf\ng\n')).toEqual({
      error: 'Row 1: too few fields; Row 3: too few fields; Row 4: too few fields …and 2 more',
    })
  })
  it('refuses two columns with the same name, which would silently drop one', () => {
    expect(parseRecords('Name,Name\nAbel,Sara\n')).toEqual({ error: 'Two columns are named "Name"' })
    expect(parseRecords('Name, Name \nAbel,Sara\n')).toEqual({ error: 'Two columns are named "Name"' })
  })
  it('refuses a header cell with no name', () => {
    expect(parseRecords('Name,,Date\nAbel,x,18 Sep\n')).toEqual({ error: 'Column 2 has no name' })
  })
  it('refuses more rows than a job can hold', () => {
    const csv = `Name\n${Array.from({ length: MAX_JOB_RECORDS + 1 }, (_, i) => `row ${i}`).join('\n')}\n`
    expect(parseRecords(csv)).toEqual({ error: `${MAX_JOB_RECORDS + 1} rows is more than the limit of ${MAX_JOB_RECORDS}` })
  })
})
