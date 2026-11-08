import crypto from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { db, now } from './db.ts'

export interface User {
  id: number
  username: string
  is_admin: number
  prefs: string
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: User
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(password, salt, 64)
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split('$')
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false
  const expected = Buffer.from(hashB64, 'base64')
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length)
  return crypto.timingSafeEqual(actual, expected)
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

export function createSession(userId: number, device: string | undefined): string {
  const token = crypto.randomBytes(32).toString('base64url')
  db.prepare('INSERT INTO sessions(token_hash, user_id, device, created_at, last_seen) VALUES (?,?,?,?,?)')
    .run(sha256(token), userId, device ?? null, now(), now())
  return token
}

export function deleteSession(token: string) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token))
}

/** Token comes from `Authorization: Bearer x`, `X-Emby-Token`-style header, or `?api_key=` (for <img>/<a> URLs). */
export function tokenFrom(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization
  if (h?.startsWith('Bearer ')) return h.slice(7).trim()
  const x = req.headers['x-caravan-token'] ?? req.headers['x-jellyreader-token']
  if (typeof x === 'string' && x) return x
  const q = (req.query as Record<string, unknown> | undefined)?.api_key
  if (typeof q === 'string' && q) return q
  return undefined
}

export function userFromToken(token: string | undefined): User | undefined {
  if (!token) return undefined
  const hash = sha256(token)
  const user = db.prepare(`
    SELECT u.id, u.username, u.is_admin, u.prefs FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?`).get(hash) as User | undefined
  if (user) db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(now(), hash)
  return user
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const user = userFromToken(tokenFrom(req))
  if (!user) return reply.code(401).send({ error: 'Not signed in' })
  req.user = user
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  await requireUser(req, reply)
  if (reply.sent) return
  if (!req.user?.is_admin) return reply.code(403).send({ error: 'Administrator access required' })
}

export const userCount = () => (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n

export const publicUser = (u: User) => ({
  id: u.id,
  username: u.username,
  isAdmin: !!u.is_admin,
  prefs: safeJson(u.prefs, {}),
})

export function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try { return JSON.parse(s) as T } catch { return fallback }
}
