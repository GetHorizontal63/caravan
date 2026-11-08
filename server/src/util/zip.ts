import yauzl from 'yauzl'

export interface ZipHandle {
  names: string[]
  read(name: string): Promise<Buffer | undefined>
  close(): void
}

/** Random-access ZIP reader: lists entries without inflating the whole archive. */
export function openZip(file: string): Promise<ZipHandle> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: false, decodeStrings: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('Cannot open zip'))
      const entries = new Map<string, yauzl.Entry>()
      zip.on('entry', (e: yauzl.Entry) => {
        if (!e.fileName.endsWith('/')) entries.set(e.fileName, e)
        zip.readEntry()
      })
      zip.on('error', reject)
      zip.on('end', () => {
        const lower = new Map([...entries.keys()].map(k => [k.toLowerCase(), k]))
        resolve({
          names: [...entries.keys()],
          read: name => new Promise((res, rej) => {
            const entry = entries.get(name) ?? entries.get(lower.get(name.toLowerCase()) ?? '')
            if (!entry) return res(undefined)
            zip.openReadStream(entry, (e, stream) => {
              if (e || !stream) return rej(e)
              const chunks: Buffer[] = []
              stream.on('data', (c: Buffer) => chunks.push(c))
              stream.on('end', () => res(Buffer.concat(chunks)))
              stream.on('error', rej)
            })
          }),
          close: () => zip.close(),
        })
      })
      zip.readEntry()
    })
  })
}

export const isImageName = (n: string) => /\.(jpe?g|png|gif|webp|avif|bmp)$/i.test(n)

/** Natural sort so page2 < page10. */
export const naturalCompare = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare

export function mimeFromName(n: string): string {
  const ext = n.toLowerCase().split('.').pop()
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp' } as Record<string, string>)[ext ?? ''] ?? 'application/octet-stream'
}
