import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { paths, config } from './config.ts'

import type sharpFn from 'sharp'

type Sharp = typeof sharpFn
let sharpMod: Promise<Sharp | undefined> | undefined
const loadSharp = () => (sharpMod ??= import('sharp').then(m => (m as unknown as { default: Sharp }).default).catch(() => {
  console.warn('[covers] sharp unavailable — covers will be stored unresized')
  return undefined
}))

/** Normalises any image to a ≤800px-tall JPEG and stores it. Returns the stored file name. */
export async function storeCover(bookId: number, data: Buffer): Promise<string | undefined> {
  if (!data?.length) return undefined
  const sharp = await loadSharp()
  let out = data
  if (sharp) {
    try {
      out = await sharp(data, { failOn: 'none' })
        .rotate()
        .resize({ height: 800, width: 560, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer()
    } catch (e) {
      console.warn(`[covers] cannot decode cover for book ${bookId}: ${(e as Error).message}`)
      return undefined
    }
  }
  const name = `${bookId}-${crypto.randomBytes(4).toString('hex')}.jpg`
  await fs.writeFile(path.join(paths.covers, name), out)
  return name
}

export async function deleteCover(name: string | null | undefined) {
  if (name) await fs.rm(path.join(paths.covers, path.basename(name)), { force: true })
}

export const coverPath = (name: string) => path.join(paths.covers, path.basename(name))

/** Download a remote cover. Rejects tiny placeholder images (Open Library returns 1x1 GIFs, Google a "no image" PNG). */
export async function fetchCover(url: string): Promise<Buffer | undefined> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': config.userAgent }, signal: AbortSignal.timeout(20000) })
    if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return undefined
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 2000) return undefined
    const sharp = await loadSharp()
    if (sharp) {
      const { width = 0, height = 0 } = await sharp(buf).metadata()
      if (width < 50 || height < 50) return undefined
    }
    return buf
  } catch {
    return undefined
  }
}
