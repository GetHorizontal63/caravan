import { config } from '../config.ts'

const lastCall = new Map<string, Promise<void>>()

/** Polite per-host throttle so library scans don't hammer public APIs. */
function throttle(host: string, minGapMs: number): Promise<void> {
  const prev = lastCall.get(host) ?? Promise.resolve()
  const next = prev.then(() => new Promise<void>(r => setTimeout(r, minGapMs)))
  lastCall.set(host, next)
  return prev
}

export async function getJson<T = any>(url: string, minGapMs = 300): Promise<T | undefined> {
  const host = new URL(url).host
  await throttle(host, minGapMs)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': config.userAgent, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      })
      if (res.status === 429 && /quota/i.test(await res.text())) {
        console.warn(`[metadata] ${host}: daily quota exhausted${host.includes('googleapis') ? ' — add a Google Books API key in Admin → Metadata' : ''}`)
        return undefined
      }
      if (res.status === 429 || res.status >= 500) {
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))
        continue
      }
      if (!res.ok) return undefined
      return (await res.json()) as T
    } catch (e) {
      if (attempt === 2) console.warn(`[metadata] ${host}: ${(e as Error).message}`)
    }
  }
  return undefined
}
