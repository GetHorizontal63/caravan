import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { paths } from '../config.ts'
import { requireUser } from '../auth.ts'

/**
 * Per-user images for the reader's desk background. Stored as data/backgrounds/<userId>-<random>.jpg;
 * the file name is kept in the user's reader prefs (deskBackground = "custom:<file>").
 */

type Sharp = (input: Buffer, opts?: object) => any
let sharp: Promise<Sharp | undefined> | undefined
const loadSharp = () => (sharp ??= import('sharp').then(m => (m as unknown as { default: Sharp }).default).catch(() => undefined))

const owned = (userId: number, name: string) => new RegExp(`^${userId}-[a-f0-9]{8}\\.(jpg|png|webp)$`).test(name)

export default async function backgroundRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser)

  app.get('/api/me/backgrounds', async req => {
    const files = (await fsp.readdir(paths.backgrounds)).filter(f => owned(req.user!.id, f))
    return files.map(name => ({ name }))
  })

  app.post('/api/me/backgrounds', async (req, reply) => {
    const file = await req.file()
    if (!file) return reply.code(400).send({ error: 'No image uploaded' })
    let data = await file.toBuffer()
    let ext = 'jpg'
    const s = await loadSharp()
    if (s) {
      try {
        // big enough for 4K screens, small enough to load fast on a phone
        data = await s(data, { failOn: 'none' }).rotate().resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 84, mozjpeg: true }).toBuffer()
      } catch {
        return reply.code(400).send({ error: 'That image could not be read' })
      }
    } else {
      const m = /image\/(jpeg|png|webp)/.exec(file.mimetype)
      if (!m) return reply.code(400).send({ error: 'Use a JPEG, PNG or WebP image' })
      ext = m[1] === 'jpeg' ? 'jpg' : m[1]
    }
    // keep only the newest few per user
    const mine = (await fsp.readdir(paths.backgrounds)).filter(f => owned(req.user!.id, f))
    const stats = await Promise.all(mine.map(async f => ({ f, t: (await fsp.stat(path.join(paths.backgrounds, f))).mtimeMs })))
    for (const { f } of stats.sort((a, b) => b.t - a.t).slice(4)) await fsp.rm(path.join(paths.backgrounds, f), { force: true })
    const name = `${req.user!.id}-${crypto.randomBytes(4).toString('hex')}.${ext}`
    await fsp.writeFile(path.join(paths.backgrounds, name), data)
    return { name }
  })

  app.get<{ Params: { name: string } }>('/api/me/backgrounds/:name', async (req, reply) => {
    const name = path.basename(req.params.name)
    if (!owned(req.user!.id, name) || !fs.existsSync(path.join(paths.backgrounds, name))) return reply.code(404).send({ error: 'Not found' })
    reply.header('Cache-Control', 'private, max-age=31536000, immutable').type(name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg')
    return reply.send(fs.createReadStream(path.join(paths.backgrounds, name)))
  })

  app.delete<{ Params: { name: string } }>('/api/me/backgrounds/:name', async req => {
    const name = path.basename(req.params.name)
    if (owned(req.user!.id, name)) await fsp.rm(path.join(paths.backgrounds, name), { force: true })
    return { ok: true }
  })
}
