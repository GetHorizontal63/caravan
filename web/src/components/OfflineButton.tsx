import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CloudDownload, CloudCheck } from 'lucide-react'
import { formatBytes } from '../api'
import { getOffline, onOfflineChange, removeOffline, saveOffline } from '../offline'
import { toast } from './ui'

/** Satchel's download button: keeps this version of the book on the phone for reading offline. */
export function OfflineButton({ bookId, fileId, label }: { bookId: number; fileId: number | null; label?: string }) {
  const qc = useQueryClient()
  const key = ['offline-book', bookId]
  useEffect(() => onOfflineChange(() => void qc.invalidateQueries({ queryKey: key })), [qc, bookId]) // eslint-disable-line react-hooks/exhaustive-deps
  const q = useQuery({ queryKey: key, queryFn: () => getOffline(bookId).then(b => b ?? null) })
  const [busy, setBusy] = useState(false)
  const saved = q.data

  const click = async () => {
    if (busy) return
    if (saved) {
      if (!confirm(`Remove the copy saved on this device (${formatBytes(saved.size)})? Your notes and place stay on the server.`)) return
      await removeOffline(bookId)
      toast('Removed from this device')
      return
    }
    setBusy(true)
    try {
      const b = await saveOffline(bookId, fileId)
      toast(`Saved on this device (${formatBytes(b.size)}): readable offline`)
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const title = saved ? 'Saved on this device: tap to remove' : busy ? 'Saving…' : `Save offline${label ? ` (${label})` : ''}`
  return (
    <button className={`icon-btn ${saved ? 'active' : ''} ${busy ? 'busy' : ''}`} title={title} aria-label={title} onClick={() => void click()}
      style={saved ? { color: 'var(--accent)' } : undefined}>
      {saved ? <CloudCheck size={21} /> : <CloudDownload size={21} />}
    </button>
  )
}
