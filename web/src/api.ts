/**
 * API client. When the web UI is served by the Caravan server, requests are same-origin.
 * Inside the Android/desktop shells (or a dev build pointed elsewhere) the server URL is user-supplied.
 */

const SERVER_KEY = 'jr.server'
const TOKEN_KEY = 'jr.token'

const store = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch { /* private mode */ } },
}

export const isNativeApp = () => !!(window as any).Capacitor?.isNativePlatform?.()

export function serverUrl(): string {
  return (store.get(SERVER_KEY) ?? '').replace(/\/+$/, '')
}
export function setServerUrl(url: string | null) { store.set(SERVER_KEY, url ? url.replace(/\/+$/, '') : null) }
/** Native shells must be pointed at a server before anything else works. */
export const needsServerUrl = () => isNativeApp() && !serverUrl()

export const getToken = () => store.get(TOKEN_KEY)
export const setToken = (t: string | null) => store.set(TOKEN_KEY, t)

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

type Json = Record<string, unknown> | unknown[]

export async function api<T = any>(path: string, opts: { method?: string; body?: Json | FormData; signal?: AbortSignal; keepalive?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  let body: BodyInit | undefined
  if (opts.body instanceof FormData) body = opts.body
  else if (opts.body !== undefined) { body = JSON.stringify(opts.body); headers['Content-Type'] = 'application/json' }
  const res = await fetch(serverUrl() + path, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body, signal: opts.signal, keepalive: opts.keepalive })
  if (res.status === 401 && token && !path.startsWith('/api/auth/login')) {
    setToken(null)
    window.dispatchEvent(new Event('jr:signed-out'))
  }
  if (!res.ok) {
    let msg = res.statusText
    try { msg = (await res.json()).error ?? msg } catch { /* not json */ }
    throw new ApiError(res.status, msg)
  }
  const type = res.headers.get('content-type') ?? ''
  return (type.includes('json') ? res.json() : res.text()) as Promise<T>
}

/** URL for <img>/<a> where headers can't be set. */
export function authedUrl(path: string, params: Record<string, string | number | null | undefined> = {}) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) q.set(k, String(v))
  const t = getToken()
  if (t) q.set('api_key', t)
  return `${serverUrl()}${path}?${q}`
}

export const spineUrl = (b: { id: number; spineVersion?: string | null; hasSpine?: boolean }) =>
  b.hasSpine ? authedUrl(`/api/books/${b.id}/spine`, { v: b.spineVersion }) : undefined

export const coverUrl = (b: { id: number; coverVersion?: string | null; hasCover?: boolean }) =>
  b.hasCover === false ? undefined : authedUrl(`/api/books/${b.id}/cover`, { v: b.coverVersion })

// ---- shared types -----------------------------------------------------------

export interface BookSummary {
  id: number
  libraryId: number
  title: string
  authors: string[]
  series: string | null
  seriesIndex: number | null
  format: string
  hasCover: boolean
  coverVersion: string | null
  /** dominant cover colour (#rrggbb), for generated spines */
  coverColor: string | null
  hasSpine: boolean
  spineVersion: string | null
  pageCount: number | null
  progress: number
  finished: boolean
  favorite: boolean
  lastRead: number | null
  addedAt: number
}

export interface BookDetail extends BookSummary {
  authorIds: { id: number; name: string }[]
  subtitle: string | null
  description: string | null
  publisher: string | null
  published: string | null
  language: string | null
  isbn13: string | null
  isbn10: string | null
  pageCount: number | null
  tags: string[]
  size: number
  fileName: string
  formatLabel: string
  engine: 'foliate' | 'pdf'
  comic: boolean
  coverSource: string | null
  metadataSource: string
  metadataLocked: boolean
  providerIds: Record<string, string>
  locator: string | null
  /** the version `locator` belongs to */
  locatorFileId: number | null
  /** available versions (formats), the primary one first */
  files: BookFileInfo[]
  /** set when the book is on a personal shelf: yours (mine) or shared with you by ownerName */
  shelf: { mine: boolean; ownerName: string | null; sharedWith: number } | null
}

export interface BookFileInfo {
  id: number
  format: string
  label: string
  size: number
  engine: 'foliate' | 'pdf'
  comic: boolean
  primary: boolean
  fileName: string
}

export interface Library {
  id: number
  name: string
  kind: 'books' | 'comics'
  paths?: string[]
  fetchMetadata: boolean
  count: number
  lastScan: number | null
}

export interface User {
  id: number
  username: string
  isAdmin: boolean
  prefs: Record<string, any>
}

export interface RemoteBook {
  provider: 'openlibrary' | 'googlebooks'
  providerId: string
  title: string
  subtitle?: string
  authors: string[]
  description?: string
  publisher?: string
  published?: string
  language?: string
  isbn13?: string
  pageCount?: number
  series?: string
  coverUrl?: string
  score?: number
}

export interface Annotation {
  id: number
  kind: 'highlight' | 'bookmark'
  /** where it is in the version being read; null when made in another version and not (yet) found here */
  locator: string | null
  /** position in the book (0..1) when it was made, for finding it in other versions */
  fraction?: number | null
  /** the version it was made in */
  fileId?: number | null
  originFormat?: string | null
  /** made in the version being read */
  native?: boolean
  /** searched for in this version and not found */
  unanchored?: boolean
  text: string | null
  note: string | null
  color: string | null
  chapter: string | null
  createdAt: number
}

export const formatBytes = (n: number) => {
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`
}

export interface Collection {
  id: number
  libraryId: number
  name: string
  description: string | null
  createdBy: number | null
  count: number
  covers: { id: number; coverVersion: string }[]
  updatedAt: number
  libraryName?: string
  createdByName?: string | null
  canEdit?: boolean
  /** only from /api/books/:id/collections */
  contains?: boolean
}

export interface DictionaryEntry {
  id: string
  /** with syllable breaks, e.g. "plan·et" */
  headword: string
  homograph: number | null
  partOfSpeech: string | null
  /** Merriam-Webster respelling ("ˈdün") and a recording when there is one */
  pronunciations: { written: string; audio: string | null }[]
  definitions: string[]
  inflections: string[]
  offensive: boolean
}

export interface Definition {
  word: string
  entries: DictionaryEntry[]
  suggestions: string[]
  url: string
}

export interface SeriesSummary {
  name: string
  count: number
  coverBook: number | null
  coverFile: string | null
}
