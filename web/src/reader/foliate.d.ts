declare module 'foliate-js/view.js' {
  export function makeBook(file: File | string): Promise<any>
  export class View extends HTMLElement {}
}
declare module 'foliate-js/search.js' {
  export function searchMatcher(walker: any, opts: any): (doc: Document, query: string) => Generator<{ range: Range; excerpt: any }>
}
declare module 'foliate-js/text-walker.js' {
  export const textWalker: any
}
declare module 'foliate-js/overlayer.js' {
  export const Overlayer: any
}
declare module 'foliate-js/comic-book.js' {
  export function makeComicBook(loader: any, file: File): Promise<any>
}
declare module 'foliate-js/vendor/zip.js' {
  export const configure: any
  export const ZipReader: any
  export const BlobReader: any
  export const BlobWriter: any
}
