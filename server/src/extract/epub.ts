import path from 'node:path'
import { openZip } from '../util/zip.ts'
import { findIsbns } from '../metadata/isbn.ts'
import { parseOpf, xml } from './opf.ts'
import { attr, list, stripHtml, type ExtractedMeta } from './types.ts'
import { mimeFromName } from '../util/zip.ts'

const resolve = (base: string, href: string) =>
  path.posix.normalize(path.posix.join(path.posix.dirname(base), decodeURIComponent(href.split('#')[0])))

export async function extractEpub(file: string): Promise<ExtractedMeta> {
  const zip = await openZip(file)
  try {
    const container = (await zip.read('META-INF/container.xml'))?.toString('utf8')
    if (!container) throw new Error('Not an EPUB (missing container.xml)')
    const rootfiles = list(xml.parse(container)?.container?.rootfiles?.rootfile)
    const opfPath = attr(rootfiles[0], 'full-path')
    if (!opfPath) throw new Error('EPUB has no rootfile')
    const opfSrc = (await zip.read(opfPath))?.toString('utf8')
    if (!opfSrc) throw new Error('EPUB rootfile missing')

    const { meta, coverHref, spine } = parseOpf(opfSrc)

    if (coverHref) {
      const name = resolve(opfPath, coverHref)
      const data = await zip.read(name)
      if (data?.length) meta.cover = { data, mime: mimeFromName(name) }
    }

    // No ISBN in the metadata? Look at the copyright page (usually in the first or last few sections).
    if (!meta.isbns?.length) {
      const candidates = [...spine.slice(0, 6), ...spine.slice(-3)]
      for (const href of candidates) {
        const html = (await zip.read(resolve(opfPath, href)))?.toString('utf8')
        const found = html ? findIsbns(stripHtml(html) ?? '') : []
        if (found.length) { meta.isbns = found; break }
      }
    }
    return meta
  } finally {
    zip.close()
  }
}
