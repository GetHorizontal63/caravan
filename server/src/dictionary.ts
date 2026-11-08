/**
 * Word look-ups from the Merriam-Webster Collegiate® Dictionary (https://dictionaryapi.com).
 *
 * The API key stays on the server (Admin → Metadata & server); clients call GET /api/define.
 * Results are cached for 30 days, because the free key allows 1,000 look-ups a day.
 */
import { db, getSettings, now } from './db.ts'
import { config } from './config.ts'

export interface Pronunciation {
  /** Merriam-Webster's pronunciation respelling, e.g. "ˈdün" */
  written: string
  /** recording of the word, when Merriam-Webster has one */
  audio: string | null
}

export interface DictionaryEntry {
  id: string
  /** headword with syllable breaks, e.g. "plan·et" */
  headword: string
  /** 1, 2… when the same spelling has several entries (homographs) */
  homograph: number | null
  partOfSpeech: string | null
  pronunciations: Pronunciation[]
  definitions: string[]
  /** e.g. "plural planets" */
  inflections: string[]
  offensive: boolean
}

export interface Definition {
  word: string
  entries: DictionaryEntry[]
  /** spellings Merriam-Webster suggests when the word wasn't found */
  suggestions: string[]
  url: string
}

export class DictionaryError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const API = 'https://www.dictionaryapi.com/api/v3/references/collegiate/json/'
const CACHE_DAYS = 30

/** Selected text → a word worth looking up ("‘Arrakis,’" → "Arrakis"). */
export function cleanWord(raw: string): string | null {
  const w = raw.normalize('NFC').replace(/[‘’ʼ]/g, "'").replace(/\s+/g, ' ')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')   // quotes, commas, dashes around it
    .replace(/'s$/i, '')                                // possessive: "Paul's" → "Paul"
  if (!w || w.length > 40 || w.split(' ').length > 3 || !/\p{L}/u.test(w)) return null
  return w
}

/** https://dictionaryapi.com/products/json#sec-2.prs: where Merriam-Webster keeps each recording */
function audioUrl(file: string | undefined): string | null {
  if (!file) return null
  const sub = file.startsWith('bix') ? 'bix' : file.startsWith('gg') ? 'gg' : /^[\d\W_]/.test(file) ? 'number' : file[0]
  return `https://media.merriam-webster.com/audio/prons/en/us/mp3/${sub}/${encodeURIComponent(file)}.mp3`
}

function toEntry(e: any): DictionaryEntry {
  const id = String(e?.meta?.id ?? '')
  const prs: any[] = e?.hwi?.prs ?? e?.prs ?? []
  return {
    id,
    headword: String(e?.hwi?.hw ?? id.split(':')[0]).replace(/\*/g, '·'),
    homograph: typeof e?.hom === 'number' ? e.hom : null,
    partOfSpeech: typeof e?.fl === 'string' ? e.fl : null,
    pronunciations: prs.filter(p => p?.mw).map(p => ({ written: String(p.mw), audio: audioUrl(p?.sound?.audio) })),
    definitions: Array.isArray(e?.shortdef) ? e.shortdef.map(String) : [],
    inflections: (e?.ins ?? []).map((i: any) => [i?.il, String(i?.if ?? '').replace(/\*/g, '·')].filter(Boolean).join(' ')).filter(Boolean),
    offensive: !!e?.meta?.offensive,
  }
}

/** Keep the entries for the word itself, not every phrase containing it ("dune buggy" for "dune"). */
function relevant(word: string, raw: any[]): any[] {
  const w = word.toLowerCase()
  const base = (e: any) => String(e?.meta?.id ?? '').split(':')[0].toLowerCase()
  const exact = raw.filter(e => base(e) === w)
  if (exact.length) return exact
  const stems = raw.filter(e => (e?.meta?.stems ?? []).some((s: string) => s.toLowerCase() === w))
  return (stems.length ? stems : raw).slice(0, 4)
}

export async function define(rawWord: string): Promise<Definition> {
  const word = cleanWord(rawWord)
  if (!word) throw new DictionaryError(400, 'Select a single word (or a short phrase) to look it up.')
  const cacheKey = word.toLowerCase()
  const hit = db.prepare('SELECT json, fetched_at FROM dictionary_cache WHERE word = ?').get(cacheKey) as { json: string; fetched_at: number } | undefined
  if (hit && now() - hit.fetched_at < CACHE_DAYS * 86400_000) return JSON.parse(hit.json) as Definition

  const key = getSettings().merriamWebsterApiKey?.trim()
  if (!key) throw new DictionaryError(503, 'The dictionary isn’t set up yet. An administrator can add a free Merriam-Webster key in Administration → Metadata & server.')

  let raw: unknown
  try {
    const res = await fetch(API + encodeURIComponent(word) + '?key=' + encodeURIComponent(key), {
      headers: { 'User-Agent': config.userAgent, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    })
    const text = await res.text()
    // a bad key comes back as a plain-text message, not JSON
    if (!res.ok || /invalid api key|key not authorized/i.test(text)) {
      throw new DictionaryError(502, /key/i.test(text) ? 'Merriam-Webster refused the dictionary key. Check it in Administration → Metadata & server (it must be a Collegiate Dictionary key).' : `Merriam-Webster answered ${res.status}.`)
    }
    raw = JSON.parse(text)
  } catch (e) {
    if (e instanceof DictionaryError) throw e
    throw new DictionaryError(502, 'Couldn’t reach Merriam-Webster. Check the server’s internet connection and try again.')
  }

  const list = Array.isArray(raw) ? raw : []
  const result: Definition = {
    word,
    entries: relevant(word, list.filter(x => x && typeof x === 'object')).map(toEntry).filter(e => e.definitions.length),
    suggestions: list.filter((x): x is string => typeof x === 'string').slice(0, 8),
    url: `https://www.merriam-webster.com/dictionary/${encodeURIComponent(word)}`,
  }
  db.prepare('INSERT INTO dictionary_cache(word, json, fetched_at) VALUES (?, ?, ?) ON CONFLICT(word) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at')
    .run(cacheKey, JSON.stringify(result), now())
  return result
}
