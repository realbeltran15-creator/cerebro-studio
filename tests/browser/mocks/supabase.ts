type Row = Record<string, any>
const db: Record<string, Row[]> = (window as any).__DB
let seq = 0
// Ids stay unique across full page loads (the counter alone restarts at 0 on every load), like real uuids.
const uid = () => `new-${Date.now().toString(36)}${(++seq).toString(36)}`
function q(table: string) {
  const filters: Array<(r: Row) => boolean> = []
  let op = 'select', payload: any = null, ret = false
  const api: any = {
    select() { if (op !== 'select') ret = true; return api },
    eq(c: string, v: any) { filters.push(r => r[c] === v); return api },
    neq(c: string, v: any) { filters.push(r => r[c] !== v); return api },
    in(c: string, v: any[]) { filters.push(r => v.includes(r[c])); return api },
    not(c: string, _o: string, v: any) { filters.push(r => r[c] !== v); return api },
    order() { return api }, limit() { return api },
    update(p: Row) { op = 'update'; payload = p; return api },
    insert(p: Row) { op = 'insert'; payload = p; return api },
    delete() { op = 'delete'; return api },
    upsert(p: Row) { op = 'upsert'; payload = p; return api },
    async maybeSingle() { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null } },
    async single() { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] : r.data, error: null } },
    then(a: any, b: any) { return Promise.resolve(run()).then(a, b) },
  }
  function run() {
    const rows = (db[table] ??= [])
    const m = rows.filter(r => filters.every(f => f(r)))
    if (op === 'select') return { data: JSON.parse(JSON.stringify(m)), error: null }
    if (op === 'update') { m.forEach(r => Object.assign(r, JSON.parse(JSON.stringify(payload)))); return { data: ret ? m : null, error: null } }
    if (op === 'upsert') {
      const hit = rows.find(r => r.owner_id === payload.owner_id && r.provider === payload.provider && r.capability === payload.capability)
      if (hit) Object.assign(hit, JSON.parse(JSON.stringify(payload))); else rows.push({ id: uid(), ...JSON.parse(JSON.stringify(payload)) })
      return { data: null, error: null }
    }
    if (op === 'delete') { db[table] = rows.filter(r => !m.includes(r)); return { data: null, error: null } }
    const row = { id: uid(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...JSON.parse(JSON.stringify(payload)) }
    rows.push(row); return { data: [row], error: null }
  }
  return api
}
const client = {
  auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
  from: q,
  storage: { from: () => ({ upload: async (path: string, blob: Blob) => { (window as any).__UPLOADS.push({ path, size: blob.size }); await (window as any).__putBlob?.(path, blob); return { error: null } }, remove: async () => ({ error: null }) }) },
}
export const getSupabaseBrowserClient = () => client
