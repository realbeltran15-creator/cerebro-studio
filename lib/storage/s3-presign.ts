import { createHash, createHmac } from 'node:crypto'

/**
 * AWS Signature V4 query-string presigning (S3-compatible: Cloudflare R2, AWS S3, Backblaze B2…).
 * Server-only. No SDK: the algorithm is small and checked against AWS's documented test vector.
 */
export type PresignInput = {
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE'
  host: string
  /** Absolute path, e.g. `/bucket/user/project/file.mp4` (path-style) or `/file.mp4` (virtual-host). */
  path: string
  accessKeyId: string
  secretAccessKey: string
  region: string
  expiresSeconds: number
  /** When set (PUT), the upload must send exactly this Content-Type. */
  contentType?: string
  now?: Date
}

const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
export const encodePath = (p: string) => p.split('/').map(enc).join('/')
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data, 'utf8').digest()
const sha256 = (data: string) => createHash('sha256').update(data, 'utf8').digest('hex')

export function amzDate(d: Date) {
  const iso = d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  return { stamp: iso, day: iso.slice(0, 8) }
}

export function presignUrl(i: PresignInput) {
  const { stamp, day } = amzDate(i.now ?? new Date())
  const scope = `${day}/${i.region}/s3/aws4_request`
  const params: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${i.accessKeyId}/${scope}`,
    'X-Amz-Date': stamp,
    'X-Amz-Expires': String(Math.max(1, Math.min(604800, Math.floor(i.expiresSeconds)))),
    'X-Amz-SignedHeaders': i.contentType ? 'content-type;host' : 'host',
  }
  const query = Object.keys(params).sort().map(k => `${enc(k)}=${enc(params[k])}`).join('&')
  const canonicalPath = encodePath(i.path)
  const headers = i.contentType ? `content-type:${i.contentType.trim()}\nhost:${i.host}` : `host:${i.host}`
  const canonical = [i.method, canonicalPath, query, headers, '', params['X-Amz-SignedHeaders'], 'UNSIGNED-PAYLOAD'].join('\n')
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n')
  const key = hmac(hmac(hmac(hmac(`AWS4${i.secretAccessKey}`, day), i.region), 's3'), 'aws4_request')
  const signature = createHmac('sha256', key).update(toSign, 'utf8').digest('hex')
  return `https://${i.host}${canonicalPath}?${query}&X-Amz-Signature=${signature}`
}
