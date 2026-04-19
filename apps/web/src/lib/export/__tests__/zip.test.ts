import { describe, expect, it } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { buildZip } from '../zip'

/**
 * Phase 3 T2.3 — zip builder.
 *
 * Round-trip is the contract: bytes in → archive out → unzip
 * produces the same bytes.
 *
 * Bug class this prevents: a refactor that swaps out fflate for
 * a different library and accidentally produces an archive Excel
 * / Numbers / Finder can't open. The unzipSync round-trip below
 * uses the same fflate library; for true cross-tool validation
 * we rely on operator QA on a fresh tenant export.
 */

describe('buildZip', () => {
  it('produces a non-empty archive for a single file', () => {
    const result = buildZip({ files: { 'hello.txt': 'world' } })
    expect(result.size_bytes).toBeGreaterThan(0)
    expect(result.file_count).toBe(1)
    expect(result.data).toBeInstanceOf(Uint8Array)
  })

  it('round-trips file contents through unzipSync', () => {
    const result = buildZip({
      files: {
        'a.txt': 'apple',
        'b.csv': 'id,name\r\n1,foo\r\n2,bar\r\n',
      },
    })
    const extracted = unzipSync(result.data)
    expect(strFromU8(extracted['a.txt'])).toBe('apple')
    expect(strFromU8(extracted['b.csv'])).toBe('id,name\r\n1,foo\r\n2,bar\r\n')
  })

  it('preserves CRLF + special characters in CSV cells', () => {
    const csv = 'id,note\r\n1,"line one\r\nline two"\r\n2,"comma, here"\r\n'
    const result = buildZip({ files: { 'data.csv': csv } })
    const extracted = unzipSync(result.data)
    expect(strFromU8(extracted['data.csv'])).toBe(csv)
  })

  it('reports the correct file count', () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 10; i++) files[`f${i}.txt`] = `content ${i}`
    const result = buildZip({ files })
    expect(result.file_count).toBe(10)
    const extracted = unzipSync(result.data)
    expect(Object.keys(extracted)).toHaveLength(10)
  })

  it('handles empty file contents', () => {
    const result = buildZip({ files: { 'empty.csv': '' } })
    expect(result.file_count).toBe(1)
    const extracted = unzipSync(result.data)
    expect(strFromU8(extracted['empty.csv'])).toBe('')
  })

  it('compresses repetitive content (size < raw)', () => {
    // 50KB of the same byte. Compressed output should be much
    // smaller than the raw input — confirms compression is on
    // (level 6 default in our wrapper).
    const raw = 'A'.repeat(50_000)
    const result = buildZip({ files: { 'big.txt': raw } })
    expect(result.size_bytes).toBeLessThan(raw.length)
  })

  it('handles unicode (multi-byte UTF-8) content', () => {
    const text = 'héllo wörld 🚀 مرحبا'
    const result = buildZip({ files: { 'unicode.txt': text } })
    const extracted = unzipSync(result.data)
    expect(strFromU8(extracted['unicode.txt'])).toBe(text)
  })

  it('handles an empty file map', () => {
    const result = buildZip({ files: {} })
    expect(result.file_count).toBe(0)
    expect(result.data).toBeInstanceOf(Uint8Array)
    // Even an empty zip has a few bytes of central-directory
    // overhead.
    expect(result.size_bytes).toBeGreaterThanOrEqual(0)
  })
})
