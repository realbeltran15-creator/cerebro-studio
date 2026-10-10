// Backend stand-in for the real end-to-end test: the database lives in sessionStorage and every uploaded file in IndexedDB,
// so both survive the full page loads the app performs (closing and reopening an edit really reloads everything).
(() => {
  const saved = sessionStorage.getItem('cerebro.db')
  window.__DB = saved ? JSON.parse(saved) : { projects: [{ id: 'p1', name: 'Proyecto lo-fi', description: null, status: 'draft', updated_at: '2026-10-11T08:00:00Z' }], render_jobs: [], assets: [], scenes: [], storyboards: [], scripts: [], publication_jobs: [] }
  window.__UPLOADS = []
  window.addEventListener('pagehide', () => sessionStorage.setItem('cerebro.db', JSON.stringify(window.__DB)))
  const idb = new Promise((resolve, reject) => { const r = indexedDB.open('cerebro-e2e', 1); r.onupgradeneeded = () => r.result.createObjectStore('blobs'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
  const tx = async (mode, fn) => { const db = await idb; return new Promise((resolve, reject) => { const t = db.transaction('blobs', mode); const req = fn(t.objectStore('blobs')); t.oncomplete = () => resolve(req?.result); t.onerror = () => reject(t.error) }) }
  window.__putBlob = (path, blob) => tx('readwrite', s => s.put(blob, path))
  window.__getBlob = path => tx('readonly', s => s.get(path))
  const realFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    if (url.endsWith('/api/storage/upload-url')) {
      const b = JSON.parse(init.body)
      return json({ driver: 'supabase', storagePath: `u1/${b.projectId}/${b.folder}/${crypto.randomUUID()}.${b.ext}`, maxBytes: 50 * 1024 * 1024 })
    }
    const m = url.match(/\/api\/assets\/([^/]+)\/signed-url/)
    if (m) {
      const a = window.__DB.assets.find(x => x.id === m[1])
      const blob = a?.storage_path ? await window.__getBlob(a.storage_path) : null
      return blob ? json({ url: URL.createObjectURL(blob) }) : json({ error: 'not found' }, 404)
    }
    if (url.endsWith('/api/storage/object')) return json({ ok: true })
    if (url.includes('/api/providers/status') || url.includes('/api/studio/catalog')) return json({ providers: [], models: [] })
    return realFetch(input, init)
  }
})()
