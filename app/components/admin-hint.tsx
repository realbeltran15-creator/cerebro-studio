/**
 * Technical detail for whoever administers the deployment. Normal users read the plain-language message; the internal names of the
 * server settings stay behind this fold instead of in the middle of the screen.
 */
export function AdminHint({ names, note }: { names: string[]; note?: string }) {
  return <details className="small muted" style={{ marginTop: 4 }}>
    <summary>Detalles técnicos (para quien administra Cerebro Studio)</summary>
    <p style={{ margin: '4px 0' }}>{note ?? 'Ajustes del servidor que faltan:'} {names.map((n, i) => <span key={n}>{i > 0 ? ', ' : ''}<code>{n}</code></span>)}.</p>
  </details>
}
