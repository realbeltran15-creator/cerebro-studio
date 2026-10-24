type Row = Record<string, any>
const db: Record<string, Row[]> = (window as any).__DB
let seq = 0
// Ids stay unique across full page loads (the counter alone restarts at 0 on every load), like real uuids.
const uid = () => `new-${Date.now().toString(36)}${(++seq).toString(36)}`
const KNOWN_COLUMNS: Record<string, string[]> = {
  render_jobs: ['id', 'owner_id', 'project_id', 'output_format', 'status', 'composition', 'output_asset_id', 'error', 'created_at', 'updated_at'],
}
function q(table: string) {
  const filters: Array<(r: Row) => boolean> = []
  let op = 'select', payload: any = null, ret = false
  const api: any = {
    select() { if (op !== 'select') ret = true; return api },
    eq(c: string, v: any) { filters.push(r => (c.includes('->>') ? r[c.split('->>')[0]]?.[c.split('->>')[1]] : r[c]) === v); return api },
    neq(c: string, v: any) { filters.push(r => r[c] !== v); return api },
    in(c: string, v: any[]) { filters.push(r => v.includes(r[c])); return api },
    not(c: string, _o: string, v: any) { filters.push(r => r[c] !== v); return api },
    or(expr: string) { const parts = expr.split(',').map(p => { const [col, op, ...rest] = p.split('.'); const v = rest.join('.'); return (r: any) => (op === 'is' && v === 'null' ? r[col] == null : op === 'eq' ? String(r[col]) === v : false) }); filters.push(r => parts.some(f => f(r))); return api },
    order() { return api }, limit() { return api }, range() { return api },
    update(p: Row) { op = 'update'; payload = p; return api },
    insert(p: Row) { op = 'insert'; payload = p; return api },
    delete() { op = 'delete'; return api },
    upsert(p: Row) { op = 'upsert'; payload = p; return api },
    async maybeSingle() { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null } },
    async single() { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] : r.data, error: null } },
    then(a: any, b: any) { return Promise.resolve(run()).then(a, b) },
  }
  function run() {
    // A table whose migration is not applied yet answers like PostgREST does.
    if (((window as any).__MISSING_TABLES ?? []).includes(table)) return { data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` } }
    // Columns of the real tables (checked against the live database): writing any other column fails, as PostgREST does.
    const cols = KNOWN_COLUMNS[table]
    if (cols && (op === 'update' || op === 'insert' || op === 'upsert')) {
      const bad = (Array.isArray(payload) ? payload : [payload]).flatMap((p: Row) => Object.keys(p)).find((k: string) => !cols.includes(k))
      if (bad) return { data: null, error: { code: 'PGRST204', message: `Could not find the '${bad}' column of '${table}' in the schema cache` } }
    }
    const rows = (db[table] ??= [])
    const m = rows.filter(r => filters.every(f => f(r)))
    if (op === 'select') return { data: JSON.parse(JSON.stringify(m)), error: null }
    if (op === 'update') { m.forEach(r => Object.assign(r, JSON.parse(JSON.stringify(payload)))); return { data: ret ? m : null, error: null } }
    if (op === 'upsert' && Array.isArray(payload)) {
      // Batch upsert keyed by id (onConflict: 'id').
      for (const p of JSON.parse(JSON.stringify(payload))) { const hit = rows.find(r => r.id === p.id); if (hit) Object.assign(hit, p); else rows.push({ ...p }) }
      return { data: null, error: null }
    }
    if (op === 'upsert') {
      const hit = rows.find(r => r.owner_id === payload.owner_id && r.provider === payload.provider && r.capability === payload.capability)
      if (hit) Object.assign(hit, JSON.parse(JSON.stringify(payload))); else rows.push({ id: uid(), ...JSON.parse(JSON.stringify(payload)) })
      return { data: null, error: null }
    }
    if (op === 'delete') { db[table] = rows.filter(r => !m.includes(r)); return { data: null, error: null } }
    const list = (Array.isArray(payload) ? payload : [payload]).map((p: Row) => ({ id: uid(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...JSON.parse(JSON.stringify(p)) }))
    rows.push(...list); return { data: list, error: null }
  }
  return api
}
const client = {
  auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }), getSession: async () => ({ data: { session: { access_token: 'test-access-token', user: { id: 'u1' } } } }) },
  from: q,
  storage: { from: () => ({
    upload: async (path: string, blob: Blob) => {
      ;((window as any).__UPLOADS ??= []).push({ path, size: blob.size }); await (window as any).__putBlob?.(path, blob)
      // Small JSON files (recovery points) are kept so they can be listed and read back, like the real bucket.
      if (blob.type === 'application/json') ((window as any).__STORE ??= {})[path] = await blob.text()
      return { error: null }
    },
    list: async (dir: string) => ({ data: Object.keys((window as any).__STORE ?? {}).filter(k => k.startsWith(`${dir}/`) && !k.slice(dir.length + 1).includes('/')).map(k => ({ name: k.slice(dir.length + 1), metadata: { size: (window as any).__STORE[k].length } })), error: null }),
    download: async (path: string) => { const t = (window as any).__STORE?.[path]; return t === undefined ? { data: null, error: { message: 'not found' } } : { data: new Blob([t], { type: 'application/json' }), error: null } },
    remove: async (paths: string[]) => { for (const p of paths ?? []) delete (window as any).__STORE?.[p]; return { error: null } },
  }) },
}
export const getSupabaseBrowserClient = () => client
/** Some pages import the client by relative path and call it createClient. */
export const createClient = getSupabaseBrowserClient
