import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, Volume2 } from 'lucide-react'
import { api, type Definition } from '../api'
import { Modal, Spinner } from './ui'

/** A word that's short enough to be worth looking up (1–3 words, ≤ 40 characters). */
export const isDefinable = (text: string) => {
  const t = text.trim()
  return !!t && t.length <= 40 && t.split(/\s+/).length <= 3 && /\p{L}/u.test(t)
}

function play(url: string) {
  void new Audio(url).play().catch(() => {})
}

/** Merriam-Webster definition, pronunciation and part of speech for a selected word. */
export function DefineDialog({ word: initial, onClose }: { word: string; onClose(): void }) {
  const [word, setWord] = useState(initial)
  const q = useQuery({
    queryKey: ['define', word.toLowerCase()],
    queryFn: () => api<Definition>(`/api/define?word=${encodeURIComponent(word)}`),
    staleTime: Infinity,
    retry: false,
  })
  const d = q.data

  return (
    <Modal title={<span className="define-title">{d?.word ?? word.trim()}</span>} onClose={onClose}>
      {q.isLoading && <div className="center-screen" style={{ minHeight: 160 }}><Spinner /></div>}
      {q.isError && <p className="error">{(q.error as Error).message}</p>}

      {d && !d.entries.length && (
        <div className="define-none">
          <p>“{d.word}” isn’t in the dictionary.</p>
          {!!d.suggestions.length && (
            <>
              <p className="small faint">Did you mean:</p>
              <div className="chips" style={{ flexWrap: 'wrap' }}>
                {d.suggestions.map(s => <button key={s} className="chip" onClick={() => setWord(s)}>{s}</button>)}
              </div>
            </>
          )}
        </div>
      )}

      {d?.entries.map(e => (
        <section key={e.id} className="define-entry">
          <div className="define-head">
            <span className="define-hw">{e.headword}{e.homograph != null && <sup>{e.homograph}</sup>}</span>
            {e.partOfSpeech && <span className="define-pos">{e.partOfSpeech}</span>}
          </div>
          {!!e.pronunciations.length && (
            <div className="define-prs" aria-label="Pronunciation">
              {e.pronunciations.map((p, i) => (
                <span key={i} className="define-pr">
                  <span className="define-mw">\{p.written}\</span>
                  {p.audio && <button className="icon-btn" onClick={() => play(p.audio!)} aria-label={`Hear “${e.headword.replace(/·/g, '')}”`} title="Listen"><Volume2 size={17} /></button>}
                </span>
              ))}
            </div>
          )}
          {!!e.inflections.length && <div className="small faint define-ins">{e.inflections.join('; ')}</div>}
          <ol className="define-defs">
            {e.definitions.map((def, i) => <li key={i}>{def}</li>)}
          </ol>
        </section>
      ))}

      {d && (
        <div className="define-credit">
          <span>Definitions from the Merriam-Webster Collegiate® Dictionary</span>
          <a href={d.url} target="_blank" rel="noopener" className="btn small ghost"><ExternalLink size={14} />Merriam-Webster</a>
        </div>
      )}
    </Modal>
  )
}
