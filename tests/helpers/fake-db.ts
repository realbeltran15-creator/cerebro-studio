/** Minimal in-memory stand-in for the Supabase query builder used by server code in tests. */
type Row = Record<string, any>

export function fakeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map(r => ({ ...r }))]))
  let seq = 0
  function query(table: string) {
    const rows = () => (tables[table] ??= [])
    const filters: Array<(r: Row) => boolean> = []
    let op: 'select' | 'update' | 'insert' | 'upsert' = 'select'
    let payload: any = null
    let count = false
    let returning = false
    const api: any = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) { if (op === 'select') count = Boolean(opts?.count); else returning = true; return api },
      eq(c: string, v: any) { filters.push(r => r[c] === v); return api },
      in(c: string, v: any[]) { filters.push(r => v.includes(r[c])); return api },
      update(p: Row) { op = 'update'; payload = p; return api },
      insert(p: Row) { op = 'insert'; payload = p; return api },
      upsert(p: Row) { op = 'upsert'; payload = p; return api },
      async maybeSingle() { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null } },
      async single() { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] : r.data, error: null } },
      then(res: any, rej: any) { return Promise.resolve(run()).then(res, rej) },
    }
    function run() {
      const match = rows().filter(r => filters.every(f => f(r)))
      if (op === 'select') return count ? { data: null, count: match.length, error: null } : { data: match, error: null }
      if (op === 'update') { match.forEach(r => Object.assign(r, payload)); return { data: returning ? match : null, error: null } }
      const row = { id: payload.id ?? `id-${++seq}`, ...payload }
      if (op === 'upsert') {
        const dupe = rows().find(r => r.action_type === row.action_type && r.entity_id === row.entity_id && r.status === row.status)
        if (dupe) { Object.assign(dupe, row); return { data: [dupe], error: null } }
      }
      rows().push(row)
      return { data: [row], error: null }
    }
    return api
  }
  return { tables, from: query } as any
}
