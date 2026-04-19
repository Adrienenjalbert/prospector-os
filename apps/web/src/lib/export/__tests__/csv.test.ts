import { describe, expect, it } from 'vitest'
import { encodeCsvField, encodeCsvRows } from '../csv'

/**
 * Phase 3 T2.3 — CSV serialisation.
 *
 * RFC 4180 conformance is the contract: comma delimiter, CRLF
 * line endings, quote-on-special, double-quote-escape inner
 * quotes. These tests pin the rules so a refactor that
 * accidentally drops the CRLF, the quote escaping, or the JSON
 * round-trip for object cells fails loudly.
 *
 * Bug class this prevents: an export that opens in Excel but
 * silently corrupts when re-imported because of a missed escape
 * — the customer sees the data but can't actually use it.
 */

describe('encodeCsvField', () => {
  it('returns empty string for null / undefined', () => {
    expect(encodeCsvField(null)).toBe('')
    expect(encodeCsvField(undefined)).toBe('')
  })

  it('returns the raw string when no escaping needed', () => {
    expect(encodeCsvField('hello')).toBe('hello')
    expect(encodeCsvField('hello world')).toBe('hello world')
    expect(encodeCsvField('123 ABC xyz')).toBe('123 ABC xyz')
  })

  it('quotes fields containing commas', () => {
    expect(encodeCsvField('a,b')).toBe('"a,b"')
    expect(encodeCsvField('London, UK')).toBe('"London, UK"')
  })

  it('quotes fields containing CR or LF', () => {
    expect(encodeCsvField('line1\nline2')).toBe('"line1\nline2"')
    expect(encodeCsvField('line1\r\nline2')).toBe('"line1\r\nline2"')
  })

  it('escapes inner quotes by doubling, then wraps in quotes', () => {
    expect(encodeCsvField('he said "hi"')).toBe('"he said ""hi"""')
    // No comma / newline either side, but the inner quote alone
    // requires quoting under RFC 4180.
    expect(encodeCsvField('"')).toBe('""""')
  })

  it('serialises numbers and booleans without quoting', () => {
    expect(encodeCsvField(42)).toBe('42')
    expect(encodeCsvField(0)).toBe('0')
    expect(encodeCsvField(-1.5)).toBe('-1.5')
    expect(encodeCsvField(true)).toBe('true')
    expect(encodeCsvField(false)).toBe('false')
  })

  it('serialises Date objects as ISO strings', () => {
    const d = new Date('2026-04-18T12:00:00Z')
    expect(encodeCsvField(d)).toBe('2026-04-18T12:00:00.000Z')
  })

  it('JSON-stringifies objects + arrays inside the cell', () => {
    // Object → JSON → CSV-quote (because of the inner quotes in
    // the JSON output).
    expect(encodeCsvField({ a: 1, b: 'x' })).toBe('"{""a"":1,""b"":""x""}"')
    expect(encodeCsvField([1, 2, 3])).toBe('"[1,2,3]"')
  })

  it('falls back to a sentinel for circular references', () => {
    const circular: Record<string, unknown> = { a: 1 }
    circular.self = circular
    expect(encodeCsvField(circular)).toBe('__unserialisable__')
  })
})

describe('encodeCsvRows', () => {
  it('returns empty string for empty array (signal: table existed but had no rows)', () => {
    expect(encodeCsvRows([])).toBe('')
  })

  it('emits header + row for a single record', () => {
    const csv = encodeCsvRows([{ id: 1, name: 'foo' }])
    expect(csv).toBe('id,name\r\n1,foo\r\n')
  })

  it('emits CRLF line endings between records', () => {
    const csv = encodeCsvRows([
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
    ])
    expect(csv).toBe('id,name\r\n1,a\r\n2,b\r\n')
  })

  it('union of keys becomes the header (later-row keys appended)', () => {
    const csv = encodeCsvRows([
      { a: 1, b: 2 },
      { b: 20, c: 30 },
    ])
    // First-seen order: a, b appears in row 0; c appears in row 1.
    expect(csv).toBe('a,b,c\r\n1,2,\r\n,20,30\r\n')
  })

  it('missing keys produce empty cells (not column-shift)', () => {
    const csv = encodeCsvRows([
      { a: 1, b: 2, c: 3 },
      { a: 10, c: 30 },
    ])
    expect(csv).toBe('a,b,c\r\n1,2,3\r\n10,,30\r\n')
  })

  it('preserves quoting for cells with commas across multiple columns', () => {
    const csv = encodeCsvRows([
      { city: 'London, UK', count: 5 },
      { city: 'Paris, FR', count: 10 },
    ])
    expect(csv).toBe(
      'city,count\r\n"London, UK",5\r\n"Paris, FR",10\r\n',
    )
  })

  it('serialises JSONB-style cells round-trippably', () => {
    const csv = encodeCsvRows([
      { id: 1, payload: { kind: 'event', count: 3 } },
    ])
    // Header: id,payload. Row: 1,"{""kind"":""event"",""count"":3}".
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('id,payload')
    expect(lines[1]).toBe('1,"{""kind"":""event"",""count"":3}"')

    // Round-trip: extract the JSON from the cell, parse it, get
    // back the original payload.
    const cell = lines[1].slice(2) // drop "1,"
    expect(cell.startsWith('"')).toBe(true)
    const json = cell.slice(1, -1).replace(/""/g, '"')
    expect(JSON.parse(json)).toEqual({ kind: 'event', count: 3 })
  })

  it('handles null vs empty string distinguishably (null → empty cell)', () => {
    const csv = encodeCsvRows([
      { a: null, b: '' },
      { a: 'x', b: 'y' },
    ])
    expect(csv).toBe('a,b\r\n,\r\nx,y\r\n')
  })
})
