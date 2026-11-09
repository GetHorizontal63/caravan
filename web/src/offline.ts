/**
 * Offline reading (Satchel, and any browser that keeps the app open).
 *
 *  - "Save offline" stores the readable file of one version, its cover, the book's details and your notes in
 *    IndexedDB on this device.
 *  - Reading works from that copy with or without a connection.
 *  - While the server can't be reached, position, bookmarks, highlights and notes are applied locally and queued
 *    in an outbox; the outbox is sent, in order, as soon as the server answers again. New notes made on both sides
 *    are kept (they merge); a queued position only wins if it's newer than one saved elsewhere in the meantime.
 */
import { api, authedUrl, ApiError, getToken, serverUrl, type Annotation, type BookDetail } from './api'

export interface OfflineBook {
  id: number
  fileId: number | null
  format: string
  blob: Blob
  cover: Blob | null
  detail: BookDetail
  annotations: Annotation[]
  savedAt: number
  size: number
}

type Op =
  | { kind: 'progress'; bookId: number; body: { locator: string; fraction: number; fileId: number | null; at: number } }
  | { kind: 'create'; bookId: number; tempId: number; body: Record<string, unknown> }
  | { kind: 'delete'; annotationId: number }
  | { kind: 'patch'; annotationId: number; body: { note?: string; color?: string } }
type Queued = Op & { seq?: number }

// ---- IndexedDB --------------------------------------------------------------------

let dbp: Promise<IDBDatabase> | undefined
function idb(): Promise<IDBDatabase> {
  return (dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open('caravan-offline', 1)
    r.onupgradeneeded = () => {
      r.result.createObjectStore('books', { keyPath: 'id' })
      r.result.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true })
    }
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  }))
}
const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
async function store(name: 'books' | 'outbox', mode: IDBTransactionMode = 'readonly') {
  return (await idb()).transaction(name, mode).objectStore(name)
}

export const getOffline = async (id: number) => (await req((await store('books')).get(id))) as OfflineBook | undefined
export const listOffline = async () => ((await req((await store('books')).getAll())) as OfflineBook[]).sort((a, b) => b.savedAt - a.savedAt)
export async function removeOffline(id: number) { await req((await store('books', 'readwrite')).delete(id)); changed() }
export async function patchOffline(id: number, patch: Partial<OfflineBook> | ((b: OfflineBook) => Partial<OfflineBook>)) {
  const b = await getOffline(id)
  if (!b) return
  const next = { ...b, ...(typeof patch === 'function' ? patch(b) : patch) }
  await req((await store('books', 'readwrite')).put(next))
}

/** Listeners for "the set of saved books changed" (download / remove). */
const listeners = new Set<() => void>()
export const onOfflineChange = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
const changed = () => listeners.forEach(f => f())

/** Network trouble (as opposed to the server saying no). */
export const isOfflineError = (e: unknown) => !(e instanceof ApiError) || e.status === 502 || e.status === 503 || e.status === 504

// ---- saving a book ----------------------------------------------------------------------

export async function saveOffline(bookId: number, fileId?: number | null): Promise<OfflineBook> {
  const detail = await api<BookDetail>(`/api/books/${bookId}`)
  const res = await fetch(`${serverUrl()}/api/books/${bookId}/content${fileId ? `?file=${fileId}` : ''}`, { headers: { Authorization: `Bearer ${getToken()}` } })
  if (!res.ok) throw new Error(res.status === 415 ? 'This format can’t be read in the app.' : `Download failed (${res.status})`)
  const blob = await res.blob()
  const savedFile = Number(res.headers.get('X-Book-File')) || null
  const format = res.headers.get('X-Book-Format') ?? 'epub'
  const annotations = await api<Annotation[]>(`/api/books/${bookId}/annotations${savedFile ? `?file=${savedFile}` : ''}`)
  let cover: Blob | null = null
  if (detail.hasCover) cover = await fetch(authedUrl(`/api/books/${bookId}/cover`, { v: detail.coverVersion })).then(r => (r.ok ? r.blob() : null)).catch(() => null)
  const book: OfflineBook = { id: bookId, fileId: savedFile, format, blob, cover, detail, annotations, savedAt: Date.now(), size: blob.size + (cover?.size ?? 0) }
  await req((await store('books', 'readwrite')).put(book))
  changed()
  return book
}

// ---- the outbox ------------------------------------------------------------------------------

async function enqueue(op: Op) {
  const s = await store('outbox', 'readwrite')
  if (op.kind === 'progress') {
    // only the latest position per book matters
    const all = (await req(s.getAll())) as Queued[]
    for (const q of all) if (q.kind === 'progress' && q.bookId === op.bookId) await req(s.delete(q.seq!))
  }
  await req(s.add(op))
  scheduleSync()
}

export const pendingChanges = async () => (await req((await store('outbox')).count())) as number

/** Save reading position: to the server if it answers, otherwise queued (and kept in the saved copy either way). */
export async function saveProgress(bookId: number, body: { locator: string; fraction: number; fileId: number | null }, keepalive = false) {
  const at = Date.now()
  void patchOffline(bookId, b => ({ detail: { ...b.detail, locator: body.locator, progress: body.fraction, locatorFileId: body.fileId, lastRead: at } }))
  try {
    // live: the server's clock decides (a phone clock running slow must not make fresh positions look old)
    await api(`/api/books/${bookId}/progress`, { method: 'PUT', body, keepalive })
  } catch (e) {
    if (isOfflineError(e)) await enqueue({ kind: 'progress', bookId, body: { ...body, at } })
  }
}

/** New bookmark or highlight. Offline it gets a temporary (negative) id until it reaches the server. */
export async function createAnnotation(bookId: number, body: Record<string, unknown>): Promise<{ id: number }> {
  const withTime = { ...body, createdAt: Date.now() }
  try {
    return await api<{ id: number }>(`/api/books/${bookId}/annotations`, { body: withTime })
  } catch (e) {
    if (!isOfflineError(e)) throw e
    const tempId = -Date.now()
    await enqueue({ kind: 'create', bookId, tempId, body: withTime })
    return { id: tempId }
  }
}

export async function deleteAnnotation(id: number) {
  if (id < 0) return dropQueued(id) // never reached the server: just forget it
  try {
    await api(`/api/annotations/${id}`, { method: 'DELETE' })
  } catch (e) {
    if (!isOfflineError(e)) throw e
    await enqueue({ kind: 'delete', annotationId: id })
  }
}

export async function patchAnnotation(id: number, body: { note?: string; color?: string }) {
  if (id < 0) return patchQueued(id, body)
  try {
    await api(`/api/annotations/${id}`, { method: 'PATCH', body })
  } catch (e) {
    if (!isOfflineError(e)) throw e
    await enqueue({ kind: 'patch', annotationId: id, body })
  }
}

async function dropQueued(tempId: number) {
  const s = await store('outbox', 'readwrite')
  for (const q of (await req(s.getAll())) as Queued[]) {
    if ((q.kind === 'create' && q.tempId === tempId) || ((q.kind === 'patch' || q.kind === 'delete') && q.annotationId === tempId)) await req(s.delete(q.seq!))
  }
}

async function patchQueued(tempId: number, body: { note?: string; color?: string }) {
  const s = await store('outbox', 'readwrite')
  for (const q of (await req(s.getAll())) as Queued[]) {
    if (q.kind === 'create' && q.tempId === tempId) await req(s.put({ ...q, body: { ...q.body, ...body } }))
  }
}

/** Keep the saved copy's notes in step with what the reader shows. */
export async function storeAnnotations(bookId: number, fileId: number | null, notes: Annotation[]) {
  const b = await getOffline(bookId)
  if (b && b.fileId === fileId) await patchOffline(bookId, { annotations: notes })
}

let syncing: Promise<number> | null = null
let synced: (n: number) => void = () => {}

/** Send everything queued, oldest first. Stops (and keeps the rest) at the first sign of being offline. */
export function syncOutbox(): Promise<number> {
  return (syncing ??= (async () => {
    let sent = 0
    const ids = new Map<number, number>() // temporary id → real id
    try {
      for (;;) {
        const s = await store('outbox')
        const cursor = await req(s.openCursor())
        if (!cursor) break
        const q = cursor.value as Queued
        try {
          if (q.kind === 'progress') await api(`/api/books/${q.bookId}/progress`, { method: 'PUT', body: q.body })
          else if (q.kind === 'create') {
            const r = await api<{ id: number }>(`/api/books/${q.bookId}/annotations`, { body: q.body })
            ids.set(q.tempId, r.id)
            await patchOffline(q.bookId, b => ({ annotations: b.annotations.map(a => (a.id === q.tempId ? { ...a, id: r.id } : a)) }))
          } else {
            const target = ids.get(q.annotationId) ?? q.annotationId
            if (target > 0) await api(`/api/annotations/${target}`, q.kind === 'delete' ? { method: 'DELETE' } : { method: 'PATCH', body: q.body })
          }
        } catch (e) {
          if (isOfflineError(e)) break // still offline: try again later
          // the server refused (e.g. the book is gone): drop this change rather than retry forever
        }
        await req((await store('outbox', 'readwrite')).delete(q.seq!))
        sent++
      }
    } finally {
      syncing = null
    }
    if (sent) synced(sent)
    return sent
  })())
}

let timer: ReturnType<typeof setTimeout> | undefined
function scheduleSync(ms = 20_000) {
  clearTimeout(timer)
  timer = setTimeout(() => void syncOutbox().then(() => pendingChanges()).then(n => { if (n) scheduleSync(60_000) }), ms)
}

/** Start syncing: now, when the connection comes back, when the app returns to the foreground. */
export function startOfflineSync(onSynced: (n: number) => void) {
  synced = onSynced
  if (typeof indexedDB === 'undefined') return
  const kick = () => void syncOutbox()
  kick()
  window.addEventListener('online', kick)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') kick() })
  void pendingChanges().then(n => { if (n) scheduleSync(30_000) }).catch(() => {})
}
