/** ISBN helpers: normalisation, checksum validation, 10↔13 conversion and extraction from free text. */

export const clean = (s: string) => s.toUpperCase().replace(/[^0-9X]/g, '')

export function isValidIsbn10(s: string): boolean {
  if (!/^\d{9}[\dX]$/.test(s)) return false
  let sum = 0
  for (let i = 0; i < 10; i++) sum += (s[i] === 'X' ? 10 : Number(s[i])) * (10 - i)
  return sum % 11 === 0
}

export function isValidIsbn13(s: string): boolean {
  if (!/^97[89]\d{10}$/.test(s)) return false
  let sum = 0
  for (let i = 0; i < 13; i++) sum += Number(s[i]) * (i % 2 ? 3 : 1)
  return sum % 10 === 0
}

export function toIsbn13(isbn10: string): string {
  const core = '978' + isbn10.slice(0, 9)
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 ? 3 : 1)
  return core + ((10 - (sum % 10)) % 10)
}

export function toIsbn10(isbn13: string): string | undefined {
  if (!isbn13.startsWith('978')) return undefined
  const core = isbn13.slice(3, 12)
  let sum = 0
  for (let i = 0; i < 9; i++) sum += Number(core[i]) * (10 - i)
  const check = (11 - (sum % 11)) % 11
  return core + (check === 10 ? 'X' : String(check))
}

/** Returns a valid ISBN-13 for any valid ISBN-10/13 input, otherwise undefined. */
export function normalizeIsbn(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined
  const s = clean(raw)
  if (s.length === 13 && isValidIsbn13(s)) return s
  if (s.length === 10 && isValidIsbn10(s)) return toIsbn13(s)
  return undefined
}

/** Find ISBNs in arbitrary text (copyright pages, file names, identifiers). Prefers ones labelled "ISBN". */
export function findIsbns(text: string): string[] {
  const found = new Set<string>()
  const labelled = /ISBN(?:-1[03])?[:\s]*([0-9Xx][0-9Xx\s-]{8,16}[0-9Xx])/g
  for (const m of text.matchAll(labelled)) {
    const n = normalizeIsbn(m[1])
    if (n) found.add(n)
  }
  // bare 13-digit 978/979 numbers (with optional hyphens)
  const bare = /\b97[89][-\s]?(?:\d[-\s]?){9}\d\b/g
  for (const m of text.matchAll(bare)) {
    const n = normalizeIsbn(m[0])
    if (n) found.add(n)
  }
  return [...found]
}
