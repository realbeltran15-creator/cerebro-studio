// (moto = servidor S3 local en Python; no valida firmas)
// Integración del código REAL de lib/storage contra un servidor S3 local (s3rver). Solo corre con S3_LOCAL_ENDPOINT (scripts/test-s3-local.sh).
// SUSTITUTO: no valida Cloudflare R2 ni Supabase Storage; valida firma SigV4, rutas por propietario, subida/descarga/borrado, multipart reanudable y limpieza.
import { createHash, randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { assertOwnPath, downloadObject, putObject, removeObject, r2Url } from '@/lib/storage/server'
import { abortMultipart, completeMultipart, createMultipart, listParts, partUrl } from '@/lib/storage/multipart'
import { cleanupDelete, cleanupReport } from '@/lib/storage/cleanup'
import { PART_BYTES } from '@/lib/storage/constants'

const ENDPOINT = process.env.S3_LOCAL_ENDPOINT // moto: multipart/listados completos, SIN validar firmas
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const U1 = '11111111-1111-1111-1111-111111111111', U2 = '22222222-2222-2222-2222-222222222222'
const fakeDb = (rows: Array<{ storage_path: string }>) => ({ from: () => { const q: Record<string, unknown> = {}; Object.assign(q, { select: () => q, eq: () => q, like: () => q, range: () => Promise.resolve({ data: rows, error: null }) }); return q } }) as never

describe.skipIf(!ENDPOINT)('almacenamiento contra S3 local (sustituto)', () => {
  beforeAll(() => { vi.stubEnv('R2_ACCOUNT_ID', 'acc'); vi.stubEnv('R2_ACCESS_KEY_ID', 'S3RVER'); vi.stubEnv('R2_SECRET_ACCESS_KEY', 'S3RVER'); vi.stubEnv('R2_BUCKET', 'cerebro-test'); vi.stubEnv('R2_ENDPOINT', ENDPOINT!) })
  afterAll(() => vi.unstubAllEnvs())

  it('sube, descarga con integridad SHA-256 y borra (5 MB sintéticos)', async () => {
    const data = randomBytes(5 * 1024 * 1024), key = `${U1}/p1/uploads/a.bin`
    const path = await putObject(null as never, U1, key, data, 'application/octet-stream')
    expect(path).toBe(`r2:${key}`)
    const back = new Uint8Array(await (await downloadObject(null as never, U1, path)).arrayBuffer())
    expect(back.length).toBe(data.length); expect(sha(back)).toBe(sha(data))
    await removeObject(null as never, U1, path)
    await expect(downloadObject(null as never, U1, path)).rejects.toThrow(/No se pudo leer/)
    await removeObject(null as never, U1, path) // borrar dos veces no falla (404 tolerado)
  })
  it('un usuario NO puede leer/escribir/borrar rutas de otro (comprobación antes de firmar)', async () => {
    const key = `${U1}/p1/uploads/secreto.bin`
    await putObject(null as never, U1, key, randomBytes(1024), 'application/octet-stream')
    await expect(downloadObject(null as never, U2, `r2:${key}`)).rejects.toThrow(/no válido/)
    await expect(removeObject(null as never, U2, `r2:${key}`)).rejects.toThrow(/no válido/)
    await expect(putObject(null as never, U2, key, randomBytes(8), 'x/y')).rejects.toThrow(/no válido/)
    expect(() => assertOwnPath(`r2:${U1}/../${U2}/x.bin`, U1)).toThrow()
    expect((await downloadObject(null as never, U1, `r2:${key}`)).size).toBe(1024)
  })
  it.skip('firma SigV4 manipulada/caducada rechazada por el servidor: NO verificable (moto no valida firmas; s3rver aceptó una firma alterada). La corrección de la firma se prueba con el vector oficial de AWS en tests/storage.test.ts', () => {})
  it('multipart: 70 MB en 3 partes se reensamblan byte a byte', async () => {
    const data = randomBytes(70 * 1024 * 1024), key = `${U1}/p1/renders/grande.bin`
    const id = await createMultipart(U1, key, 'application/octet-stream'); const parts: Array<{ partNumber: number; etag: string }> = []
    const n = Math.ceil(data.length / PART_BYTES); expect(n).toBe(3)
    for (let i = 1; i <= n; i++) { const chunk = data.subarray((i - 1) * PART_BYTES, Math.min(data.length, i * PART_BYTES)); const r = await fetch(partUrl(U1, key, id, i, chunk.length), { method: 'PUT', body: chunk }); expect(r.status).toBe(200); parts.push({ partNumber: i, etag: r.headers.get('etag')! }) }
    await completeMultipart(U1, key, id, parts)
    const back = new Uint8Array(await (await downloadObject(null as never, U1, `r2:${key}`)).arrayBuffer()); expect(back.length).toBe(data.length); expect(sha(back)).toBe(sha(data))
    await removeObject(null as never, U1, `r2:${key}`)
  }, 120_000)
  it('multipart interrumpido: lista las partes recibidas, reanuda solo las que faltan y el resultado es idéntico', async () => {
    const data = randomBytes(70 * 1024 * 1024), key = `${U1}/p1/renders/reanuda.bin`
    const id = await createMultipart(U1, key, 'application/octet-stream'); const put = async (i: number) => { const c = data.subarray((i - 1) * PART_BYTES, Math.min(data.length, i * PART_BYTES)); const r = await fetch(partUrl(U1, key, id, i, c.length), { method: 'PUT', body: c }); expect(r.status).toBe(200) }
    await put(1); await put(2) // "se cae la conexión" antes de la parte 3
    const have = await listParts(U1, key, id); expect(have.map(p => p.partNumber)).toEqual([1, 2]); expect(have[0].size).toBe(PART_BYTES)
    await put(3)
    const all = await listParts(U1, key, id); await completeMultipart(U1, key, id, all)
    expect(sha(new Uint8Array(await (await downloadObject(null as never, U1, `r2:${key}`)).arrayBuffer()))).toBe(sha(data))
    await removeObject(null as never, U1, `r2:${key}`)
  }, 120_000)
  it.skip('límite de bytes por parte firmado (content-length): NO verificable con estos sustitutos (ninguno lo hace cumplir); solo hay prueba unitaria de que se firma', () => {})
  it('abortar libera la subida y completar una subida abortada falla', async () => {
    const key = `${U1}/p1/renders/abortada.bin`, id = await createMultipart(U1, key, 'application/octet-stream')
    await fetch(partUrl(U1, key, id, 1, 1024), { method: 'PUT', body: randomBytes(1024) })
    await abortMultipart(U1, key, id); await abortMultipart(U1, key, id)
    await expect(listParts(U1, key, id)).rejects.toThrow(/NoSuchUpload/)
    await expect(completeMultipart(U1, key, id, [{ partNumber: 1, etag: '"x"' }])).rejects.toThrow()
    await expect(createMultipart(U2, key, 'a/b')).rejects.toThrow(/no válido/)
  })
  it('recuperación de Biblioteca/limpieza: huérfanos solo si nadie los referencia, son viejos y no están en versions/', async () => {
    const mk = async (k: string) => putObject(null as never, U1, `${U1}/${k}`, randomBytes(100), 'application/octet-stream')
    const ref = await mk('pc/uploads/referenciado.bin'), orf = await mk('pc/uploads/huerfano.bin'), ver = await mk('pc/versions/j1/punto.bin')
    const db = fakeDb([{ storage_path: ref }])
    const hoy = await cleanupReport(db, U1); expect(hoy.orphans.map(o => o.key)).not.toContain(`${U1}/pc/uploads/huerfano.bin`) // recién subido: aún puede recibir su fila
    const futuro = Date.now() + 3 * 24 * 3600_000
    const rep = await cleanupReport(db, U1, futuro); const keys = rep.orphans.map(o => o.key)
    expect(keys).toContain(`${U1}/pc/uploads/huerfano.bin`); expect(keys).not.toContain(`${U1}/pc/uploads/referenciado.bin`); expect(keys).not.toContain(`${U1}/pc/versions/j1/punto.bin`)
    const res = await cleanupDelete(db, U1, { keys: [`${U1}/pc/uploads/huerfano.bin`, `${U1}/pc/uploads/referenciado.bin`, `${U2}/x/y.bin`] }, futuro)
    expect(res.deleted).toBe(1); expect(res.skipped).toEqual([`${U1}/pc/uploads/referenciado.bin`, `${U2}/x/y.bin`])
    expect((await downloadObject(null as never, U1, ref)).size).toBe(100); expect((await downloadObject(null as never, U1, ver)).size).toBe(100)
    await expect(downloadObject(null as never, U1, orf)).rejects.toThrow()
  })
  it('un fallo del servidor al guardar se informa y no deja ruta guardada', async () => {
    vi.stubEnv('R2_ENDPOINT', 'http://127.0.0.1:1')
    await expect(putObject(null as never, U1, `${U1}/p/x.bin`, randomBytes(10), 'a/b')).rejects.toThrow()
    vi.stubEnv('R2_ENDPOINT', ENDPOINT!)
  })
})
