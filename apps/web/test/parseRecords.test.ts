import { describe, expect, it } from 'vitest'
import { parseRecords } from '@/features/generate/parseRecords'

describe('parseRecords', () => {
  it('accepts a JSON array of string objects', () => {
    expect(parseRecords('[{"Name":"Abel"},{"Name":"Sara"}]')).toEqual({ records: [{ Name: 'Abel' }, { Name: 'Sara' }] })
    expect(parseRecords('{"Name":"Abel"}')).toEqual({ error: 'Expected a JSON array of objects' })
    expect(parseRecords('[{"Name":1}]')).toEqual({ error: 'Every value must be text (row 1, "Name")' })
  })
  it('accepts CSV with a header row, quotes, commas and CRLF', () => {
    expect(parseRecords('Name,Date\r\n"Tesfaye, Abel",18 Sep\r\nSara,"say ""hi"""\r\n')).toEqual({
      records: [{ Name: 'Tesfaye, Abel', Date: '18 Sep' }, { Name: 'Sara', Date: 'say "hi"' }],
    })
    expect(parseRecords('Name\n')).toEqual({ error: 'No rows under the header' })
  })
  it('strips a UTF-8 byte-order mark from the start of a CSV, so the first header names the slot', () => {
    // Excel and Windows editors prefix UTF-8 CSV with U+FEFF; left in, the first column would be
    // keyed "\uFEFFName" and never match a slot named "Name".
    expect(parseRecords('\uFEFFName,Date\nAbel,18 Sep\n')).toEqual({ records: [{ Name: 'Abel', Date: '18 Sep' }] })
    expect(parseRecords('\uFEFF[{"Name":"Abel"}]')).toEqual({ records: [{ Name: 'Abel' }] })
    expect(parseRecords('')).toEqual({ error: 'Paste a JSON array or CSV' })
  })
})
