import type { FastifyInstance } from 'fastify'
import { db, now, tx } from '../db.ts'
import { requireAdmin } from '../auth.ts'
import { canManageBook } from '../access.ts'

/**
 * Manual series management (administrators). A series is the `series` + `series_index` fields on books;
 * these endpoints create, extend, renumber and rename them. Edited books are marked metadata_source = 'manual'
 * so automatic provider lookups fill gaps but never overwrite them.
 */
export default async function seriesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin)

  const setSeries = db.prepare(`UPDATE books SET series = ?, series_index = ?, metadata_source = 'manual', updated_at = ? WHERE id = ?`)

  /** Put books into a series (new or existing). Without explicit numbers they're appended in the given order. */
  app.post<{ Body: { series: string; bookIds: number[]; indexes?: (number | null)[] } }>('/api/series/assign', async (req, reply) => {
    const name = req.body?.series?.trim()
    const ids = req.body?.bookIds ?? []
    if (!name) return reply.code(400).send({ error: 'Give the series a name' })
    if (!ids.length) return reply.code(400).send({ error: 'Choose at least one book' })
    if (ids.some(id => !canManageBook(Number(id), req.user!.id))) return reply.code(404).send({ error: 'Book not found' })
    const max = (db.prepare('SELECT COALESCE(MAX(series_index), 0) AS m FROM books WHERE series = ?').get(name) as { m: number }).m
    let next = Math.floor(max) + 1
    tx(() => {
      ids.forEach((id, i) => {
        const given = req.body.indexes?.[i]
        const index = given === undefined ? next++ : given
        setSeries.run(name.slice(0, 200), index, now(), Number(id))
      })
    })
    return { ok: true, series: name }
  })

  /** Change one book's number in its series (null = unnumbered). */
  app.post<{ Body: { bookId: number; index: number | null } }>('/api/series/index', async (req, reply) => {
    const b = canManageBook(Number(req.body?.bookId), req.user!.id) ? db.prepare('SELECT series FROM books WHERE id = ?').get(Number(req.body?.bookId)) as { series: string | null } | undefined : undefined
    if (!b?.series) return reply.code(404).send({ error: 'That book is not in a series' })
    const v = req.body.index
    setSeries.run(b.series, v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v), now(), Number(req.body.bookId))
    return { ok: true }
  })

  app.post<{ Body: { bookIds: number[] } }>('/api/series/remove', async req => {
    const upd = db.prepare(`UPDATE books SET series = NULL, series_index = NULL, metadata_source = 'manual', updated_at = ? WHERE id = ?`)
    tx(() => { for (const id of req.body?.bookIds ?? []) if (canManageBook(Number(id), req.user!.id)) upd.run(now(), Number(id)) })
    return { ok: true }
  })

  /** Rename a series (merging into another if that name already exists). */
  app.post<{ Body: { from: string; to: string } }>('/api/series/rename', async (req, reply) => {
    const to = req.body?.to?.trim()
    if (!req.body?.from || !to) return reply.code(400).send({ error: 'A new name is required' })
    const r = db.prepare(`UPDATE books SET series = ?, metadata_source = 'manual', updated_at = ? WHERE series = ? AND library_id IN (SELECT id FROM libraries WHERE owner_id IS NULL OR owner_id = ?)`).run(to.slice(0, 200), now(), req.body.from, req.user!.id)
    return { ok: true, changed: Number(r.changes), series: to }
  })
}
