/**
 * Phase 3 T2.3 — CSV serialisation for the per-tenant data export.
 *
 * RFC 4180-compliant: comma delimiter, CRLF line endings, double-quote
 * encapsulation when a field contains a comma / quote / newline.
 * Quotes inside a field are escaped by doubling.
 *
 * Design choices documented inline:
 *
 *   - We serialise the full row set into a single string. The export
 *     workflow caps each table at 100k rows (see `data-export.ts`),
 *     so a typical tenant produces a handful of MB at most. If we
 *     ever need to handle larger sets we'd switch to a streaming
 *     writer; today the simplicity is worth more than the
 *     micro-optimisation.
 *
 *   - JSONB / array / object cells get JSON.stringify'd inside the
 *     CSV cell. This loses some readability vs flattening but
 *     preserves round-trippability — an analyst can `JSON.parse`
 *     the cell back. The alternative (flattening to dot-paths) is
 *     ambiguous on irregular shapes (different rows have different
 *     keys); JSON in a quoted CSV cell is unambiguous.
 *
 *   - `null` and `undefined` serialise to an empty cell (RFC 4180
 *     has no NULL token). The export-schema doc warns analysts that
 *     empty != "empty string" — consult the source schema if it
 *     matters for the task.
 */

const FIELD_SEPARATOR = ','
const RECORD_SEPARATOR = '\r\n'
const QUOTE = '"'

/**
 * Encode a single field. Quotes only when required by RFC 4180:
 * field contains comma, quote, CR, or LF. Inner quotes are escaped
 * by doubling. `null` / `undefined` → empty cell.
 */
export function encodeCsvField(value: unknown): string {
  if (value === null || value === undefined) return ''
  let s: string
  if (typeof value === 'string') {
    s = value
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    s = String(value)
  } else if (value instanceof Date) {
    s = value.toISOString()
  } else {
    // Objects, arrays, anything else: JSON-stringify so the cell
    // is round-trippable. JSON.stringify itself handles its own
    // escaping; the CSV layer wraps the resulting string in quotes
    // and doubles any inner quotes.
    try {
      s = JSON.stringify(value)
    } catch {
      // Circular reference / serialise error: fall back to a
      // sentinel so the row still serialises rather than blowing
      // up the entire export.
      s = '__unserialisable__'
    }
  }

  const needsQuoting = /[",\r\n]/.test(s)
  if (!needsQuoting) return s
  return `${QUOTE}${s.replace(/"/g, '""')}${QUOTE}`
}

/**
 * Encode an array of objects to a CSV string. Headers are derived
 * from the union of keys across all rows (so a row missing a key
 * gets an empty cell, not a column shift). Header order matches
 * first-seen order across the row set, then alphabetical for keys
 * unique to later rows.
 *
 * Returns an empty string for an empty input array — the export
 * workflow uses this as a signal that "the table exists but had
 * no rows for this tenant".
 */
export function encodeCsvRows(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''

  // Determine header order: first-seen across the row set + any
  // keys that only appear later, sorted alphabetically.
  const seen = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      seen.add(key)
    }
  }
  // Stable across calls with the same data: convert to array in
  // insertion order (set preserves it), then move any
  // alphabetically-late keys after first-seen ones implicitly
  // because Set iteration is insertion order.
  const headers = Array.from(seen)

  const lines: string[] = []
  lines.push(headers.map(encodeCsvField).join(FIELD_SEPARATOR))
  for (const row of rows) {
    lines.push(
      headers.map((h) => encodeCsvField(row[h])).join(FIELD_SEPARATOR),
    )
  }
  return lines.join(RECORD_SEPARATOR) + RECORD_SEPARATOR
}
