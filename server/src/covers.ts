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

async function storeImage(bookId: number, data: Buffer, kind: 'cover' | 'spine'): Promise<string | undefined> {
  if (!data?.length) return undefined
  const sharp = await loadSharp()
  let out = data
  if (sharp) {
    try {
      // apply EXIF orientation first, so "is it sideways?" below looks at the picture as people see it
      let img = await sharp(data, { failOn: 'none' }).rotate().toBuffer()
      if (kind === 'spine') {
        // a spine photographed lying down: stand it up (English spines read top to bottom)
        const { width = 0, height = 0 } = await sharp(img).metadata()
        if (width > height) img = await sharp(img).rotate(90).toBuffer()
      }
      const box = kind === 'cover' ? { width: 560, height: 800 } : { width: 240, height: 1000 }
      out = await sharp(img)
        .resize({ ...box, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer()
    } catch (e) {
      console.warn(`[covers] cannot decode ${kind} for book ${bookId}: ${(e as Error).message}`)
      return undefined
    }
  }
  const name = `${bookId}-${kind === 'spine' ? 'spine-' : ''}${crypto.randomBytes(4).toString('hex')}.jpg`
  await fs.writeFile(path.join(paths.covers, name), out)
  return name
}

/** Normalises any image to a ≤800px-tall JPEG and stores it. Returns the stored file name. */
export const storeCover = (bookId: number, data: Buffer) => storeImage(bookId, data, 'cover')

/** Spine art: stood upright if photographed sideways, ≤1000px tall. Lives next to the covers. */
export const storeSpine = (bookId: number, data: Buffer) => storeImage(bookId, data, 'spine')

export async function deleteCover(name: string | null | undefined) {
  if (name) await fs.rm(path.join(paths.covers, path.basename(name)), { force: true })
}

export const coverPath = (name: string) => path.join(paths.covers, path.basename(name))

/** Dominant colour of a stored cover as #rrggbb (used to paint generated spines). */
export async function dominantColor(name: string): Promise<string | undefined> {
  const sharp = await loadSharp()
  if (!sharp) return undefined
  try {
    // shrink first: faster, and averages out text/noise so the "dominant" colour is the design's colour
    const small = await sharp(coverPath(name)).resize(32, 48, { fit: 'fill' }).toBuffer()
    const { dominant } = await sharp(small).stats()
    return '#' + [dominant.r, dominant.g, dominant.b].map(v => v.toString(16).padStart(2, '0')).join('')
  } catch {
    return undefined
  }
}

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
