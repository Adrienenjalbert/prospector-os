import { zipSync, strToU8 } from 'fflate'

/**
 * Phase 3 T2.3 — minimal zip builder for the per-tenant data export.
 *
 * Wraps `fflate`'s synchronous `zipSync` so callers don't need to
 * know about Uint8Arrays / encoding. Inputs are a flat
 * `{ filename: contents }` map; output is a `Uint8Array` ready to
 * upload to Vercel Blob.
 *
 * Why fflate vs node:zlib + adm-zip / archiver:
 *
 *   - fflate works in both the Node and Edge runtimes — Vercel
 *     Functions can run either, and we'd rather not commit the
 *     export workflow to a runtime choice.
 *   - It's tiny (~10KB) so the cold-start cost is negligible.
 *   - Synchronous compression is fine for the sizes T2.3 caps at
 *     (each table ≤ 100k rows; total output typically < 10MB).
 *     If we later need to handle gigabyte exports we'd switch to a
 *     streaming approach (and likely a paid storage path with
 *     direct multipart upload).
 *
 * Compression level 6 (default) is the right trade-off:
 *   - Level 0: no compression. Pointless for CSV.
 *   - Level 9: maximum. ~3x slower than 6 for ~5% smaller output.
 *
 * The export workflow uses STORE (no compression) for binary
 * embeddings if any sneak in via the JSONB cells — fflate handles
 * the choice automatically based on entry-level options.
 */

export interface ZipBuildInput {
  files: Record<string, string>
}

export interface ZipBuildResult {
  data: Uint8Array
  size_bytes: number
  file_count: number
}

export function buildZip(input: ZipBuildInput): ZipBuildResult {
  const entries: Record<string, Uint8Array> = {}
  for (const [filename, contents] of Object.entries(input.files)) {
    entries[filename] = strToU8(contents)
  }
  const zipped = zipSync(entries, { level: 6 })
  return {
    data: zipped,
    size_bytes: zipped.byteLength,
    file_count: Object.keys(input.files).length,
  }
}
