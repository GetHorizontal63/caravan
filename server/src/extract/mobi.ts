import fs from 'node:fs/promises'
import { normalizeIsbn } from '../metadata/isbn.ts'
import { stripHtml, type ExtractedMeta } from './types.ts'

/**
 * Minimal MOBI / AZW / AZW3 (KF8) metadata reader.
 * PalmDB header → record 0 (PalmDOC + MOBI header) → EXTH records → cover image record.
 */
export async function extractMobi(file: string): Promise<ExtractedMeta> {
  const buf = await fs.readFile(file)
  const numRecords = buf.readUInt16BE(76)
  const offsets: number[] = []
  for (let i = 0; i < numRecords; i++) offsets.push(buf.readUInt32BE(78 + i * 8))
  const recordAt = (i: number) => buf.subarray(offsets[i], i + 1 < offsets.length ? offsets[i + 1] : buf.length)

  const r0 = recordAt(0)
  if (r0.toString('latin1', 16, 20) !== 'MOBI') {
    return { title: buf.toString('latin1', 0, 32).replace(/\0.*$/s, '') || undefined }
  }
  const mobiLen = r0.readUInt32BE(20)
  const encoding = r0.readUInt32BE(28) === 65001 ? 'utf8' : 'latin1'
  const fullNameOff = r0.readUInt32BE(84)
  const fullNameLen = r0.readUInt32BE(88)
  const firstImage = r0.readUInt32BE(108)
  const exthFlags = r0.readUInt32BE(128)
  const decode = (b: Buffer) => b.toString(encoding).replace(/\0+$/, '').trim()

  const meta: ExtractedMeta = { title: decode(r0.subarray(fullNameOff, fullNameOff + fullNameLen)) || undefined }
  const authors: string[] = []
  const tags: string[] = []
  const isbns: string[] = []
  let coverOffset: number | undefined
  let thumbOffset: number | undefined

  if (exthFlags & 0x40) {
    const start = 16 + mobiLen
    if (r0.toString('latin1', start, start + 4) === 'EXTH') {
      const count = r0.readUInt32BE(start + 8)
      let p = start + 12
      for (let i = 0; i < count && p + 8 <= r0.length; i++) {
        const type = r0.readUInt32BE(p)
        const len = r0.readUInt32BE(p + 4)
        const data = r0.subarray(p + 8, p + len)
        p += len
        switch (type) {
          case 100: authors.push(decode(data)); break
          case 101: meta.publisher = decode(data); break
          case 103: meta.description = stripHtml(decode(data)); break
          case 104: { const n = normalizeIsbn(decode(data)); if (n) isbns.push(n); break }
          case 105: tags.push(decode(data)); break
          case 106: meta.published = decode(data).slice(0, 10); break
          case 201: coverOffset = data.readUInt32BE(0); break
          case 202: thumbOffset = data.readUInt32BE(0); break
          case 503: meta.title = decode(data) || meta.title; break
          case 524: meta.language = decode(data); break
        }
      }
    }
  }

  if (authors.length) meta.authors = authors.flatMap(a => a.split(/\s*[;&]\s*/)).filter(Boolean)
  if (tags.length) meta.tags = tags
  if (isbns.length) meta.isbns = isbns

  const coverIdx = coverOffset ?? thumbOffset
  if (coverIdx !== undefined && coverIdx !== 0xffffffff && firstImage !== 0xffffffff) {
    const rec = firstImage + coverIdx
    if (rec < numRecords) {
      const data = Buffer.from(recordAt(rec))
      if (data.length > 100) meta.cover = { data }
    }
  }
  return meta
}
