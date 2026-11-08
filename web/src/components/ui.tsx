import { useEffect, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'

export const Spinner = () => <div className="spinner" role="status" aria-label="Loading" />

export function Modal({ title, onClose, children, footer, wide }: { title: ReactNode; onClose(): void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function Toggle({ label, hint, checked, onChange }: { label: ReactNode; hint?: ReactNode; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="toggle">
      <span>
        <div>{label}</div>
        {hint && <div className="small faint">{hint}</div>}
      </span>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
    </label>
  )
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon ?? (
        <div className="empty-art" aria-hidden>
          <span style={{ left: 18, height: 78, background: 'linear-gradient(90deg,rgba(0,0,0,.3),transparent 20%),var(--accent)' }} />
          <span style={{ left: 48, height: 92, background: 'linear-gradient(90deg,rgba(0,0,0,.3),transparent 20%),var(--accent-2)' }} />
          <span style={{ left: 78, height: 70, transform: 'rotate(12deg)', transformOrigin: 'bottom left', background: 'linear-gradient(90deg,rgba(0,0,0,.3),transparent 20%),var(--dune)' }} />
        </div>
      )}
      <h3>{title}</h3>
      {children && <div>{children}</div>}
    </div>
  )
}

/** Tiny global toast. */
let pushToast: (msg: string) => void = () => {}
export const toast = (msg: string) => pushToast(msg)
export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    let t: number | undefined
    pushToast = m => { setMsg(m); clearTimeout(t); t = window.setTimeout(() => setMsg(null), 2800) }
    return () => clearTimeout(t)
  }, [])
  return msg ? <div className="toast" role="status">{msg}</div> : null
}
