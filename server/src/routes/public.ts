import type { FastifyInstance } from 'fastify'
import { db, getSettings, now, saveSettings } from '../db.ts'
import { createSession, deleteSession, hashPassword, publicUser, requireUser, tokenFrom, userCount, verifyPassword, type User } from '../auth.ts'

export const VERSION = '0.1.0'

export default async function publicRoutes(app: FastifyInstance) {
  app.get('/api/system/info', async () => ({
    name: 'Caravan',
    serverName: getSettings().serverName,
    version: VERSION,
    setupComplete: userCount() > 0,
  }))

  /** First-run wizard: creates the administrator. Only works while there are no users. */
  app.post<{ Body: { username: string; password: string; serverName?: string } }>('/api/setup', async (req, reply) => {
    if (userCount() > 0) return reply.code(409).send({ error: 'Setup has already been completed' })
    const { username, password, serverName } = req.body ?? ({} as any)
    if (!username?.trim() || !password || password.length < 4) return reply.code(400).send({ error: 'Username and a password of at least 4 characters are required' })
    const r = db.prepare('INSERT INTO users(username, password_hash, is_admin, created_at) VALUES (?,?,1,?)').run(username.trim(), hashPassword(password), now())
    if (serverName?.trim()) saveSettings({ serverName: serverName.trim() })
    const user = db.prepare('SELECT id, username, is_admin, prefs FROM users WHERE id = ?').get(r.lastInsertRowid) as unknown as User
    return { token: createSession(user.id, req.headers['user-agent']), user: publicUser(user) }
  })

  app.post<{ Body: { username: string; password: string; device?: string } }>('/api/auth/login', async (req, reply) => {
    const { username, password, device } = req.body ?? ({} as any)
    const row = db.prepare('SELECT id, username, is_admin, prefs, password_hash FROM users WHERE username = ?').get(username ?? '') as (User & { password_hash: string }) | undefined
    if (!row || !verifyPassword(password ?? '', row.password_hash)) {
      await new Promise(r => setTimeout(r, 400)) // slow down guessing
      return reply.code(401).send({ error: 'Invalid username or password' })
    }
    return { token: createSession(row.id, device ?? req.headers['user-agent']), user: publicUser(row) }
  })

  app.post('/api/auth/logout', async req => {
    const t = tokenFrom(req)
    if (t) deleteSession(t)
    return { ok: true }
  })

  app.get('/api/auth/me', { preHandler: requireUser }, async req => publicUser(req.user!))

  app.put<{ Body: Record<string, unknown> }>('/api/me/prefs', { preHandler: requireUser }, async req => {
    const prefs = JSON.stringify(req.body ?? {}).slice(0, 20000)
    db.prepare('UPDATE users SET prefs = ? WHERE id = ?').run(prefs, req.user!.id)
    return { ok: true }
  })

  app.post<{ Body: { current: string; password: string } }>('/api/me/password', { preHandler: requireUser }, async (req, reply) => {
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user!.id) as { password_hash: string }
    if (!verifyPassword(req.body?.current ?? '', row.password_hash)) return reply.code(400).send({ error: 'Current password is incorrect' })
    if ((req.body?.password ?? '').length < 4) return reply.code(400).send({ error: 'New password is too short' })
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(req.body.password), req.user!.id)
    return { ok: true }
  })
}
