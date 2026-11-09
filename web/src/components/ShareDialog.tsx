import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, Users } from 'lucide-react'
import { api } from '../api'
import { Modal, Spinner, toast } from './ui'

/** Choose exactly who may read one of the books on your shelf. */
export function ShareDialog({ bookId, title, onClose }: { bookId: number; title: string; onClose(): void }) {
  const qc = useQueryClient()
  const people = useQuery({ queryKey: ['shelf-people'], queryFn: () => api<{ id: number; username: string }[]>('/api/shelf/people') })
  const shares = useQuery({ queryKey: ['shelf-shares', bookId], queryFn: () => api<{ userIds: number[] }>(`/api/shelf/books/${bookId}/shares`) })
  const [picked, setPicked] = useState<Set<number> | null>(null)
  const sel = picked ?? new Set(shares.data?.userIds ?? [])
  const [busy, setBusy] = useState(false)

  const toggle = (id: number) => { const s = new Set(sel); s.has(id) ? s.delete(id) : s.add(id); setPicked(s) }
  const save = async () => {
    setBusy(true)
    try {
      const r = await api<{ userIds: number[] }>(`/api/shelf/books/${bookId}/shares`, { method: 'PUT', body: { userIds: [...sel] } })
      toast(r.userIds.length ? `Shared with ${r.userIds.length} ${r.userIds.length === 1 ? 'person' : 'people'}` : 'Private to you again')
      void qc.invalidateQueries({ queryKey: ['book', String(bookId)] })
      void qc.invalidateQueries({ queryKey: ['shelf-shares', bookId] })
      onClose()
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Share from your shelf" onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={() => void save()} disabled={busy || !shares.data}>Save</button>
      </>
    }>
      <p className="muted" style={{ marginTop: 0 }}>Choose who can read <b>{title}</b>. They’ll find it under <b>My Shelf → Shared with me</b>, with their own progress and highlights.</p>
      {people.isLoading || shares.isLoading ? <Spinner /> : !people.data?.length ? (
        <p className="small faint">There’s nobody else on this server yet.</p>
      ) : (
        <>
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <button className="btn small ghost" onClick={() => setPicked(new Set(people.data!.map(p => p.id)))}><Users size={14} />Everyone</button>
            <button className="btn small ghost" onClick={() => setPicked(new Set())}><Lock size={14} />Nobody</button>
          </div>
          <div className="share-list">
            {people.data.map(p => (
              <label key={p.id} className="share-row">
                <span className="avatar small">{p.username[0]?.toUpperCase()}</span>
                <span className="grow">{p.username}</span>
                <input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} />
              </label>
            ))}
          </div>
        </>
      )}
      <p className="small faint" style={{ marginBottom: 0 }}><Lock size={12} style={{ verticalAlign: '-1px' }} /> Nobody else can see your shelf, administrators included.</p>
    </Modal>
  )
}
