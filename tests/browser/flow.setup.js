// Minimal environment for the Flow import: an empty database, upload bookkeeping and the storage-url mock.
window.__UPLOADS = []
window.__DB = { assets: [] }
const realFetch = window.fetch.bind(window)
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url
  if (url.endsWith('/api/storage/upload-url')) {
    const b = JSON.parse(init.body)
    return new Response(JSON.stringify({ driver: 'supabase', storagePath: `u1/${b.projectId}/${b.folder}/${b.name ?? 'x'}.${b.ext}`, maxBytes: 50 * 1024 * 1024 }), { headers: { 'content-type': 'application/json' } })
  }
  return realFetch(input, init)
}
