import { parseComposition, type Composition } from '../editor/composition'

/**
 * A «render ticket»: everything the offline renderer needs to produce a montage on the person's own computer, with no account password and
 * no secret key on that computer — the montage plus short-lived signed links to its materials (the same links the editor uses). Free: the
 * work runs on the person's PC with FFmpeg. The link lifetime is the longest the signing allows (4 h); the renderer downloads first.
 */
export type TicketAsset = { url: string; kind: 'video' | 'image' | 'audio'; bytes?: number | null }
export type RenderTicket = { version: 1; createdAt: string; expiresAt: string; jobId: string; projectId: string | null; title: string; composition: Composition; assets: Record<string, TicketAsset> }

export const TICKET_TTL_S = 14_400
const VISUAL = ['image', 'thumbnail']
export const ticketKind = (assetType: string): TicketAsset['kind'] => (assetType === 'video' ? 'video' : VISUAL.includes(assetType) ? 'image' : 'audio')

/** Every asset a montage uses (clip pictures and voices, music, audio clips and overlay layers). */
export function ticketAssetIds(c: Composition) {
  return [...new Set([...c.clips.flatMap(k => [k.visualAssetId, k.voiceAssetId]), c.musicAssetId, ...(c.audioClips ?? []).map(a => a.assetId), ...(c.overlays ?? []).map(o => o.assetId)].filter((x): x is string => Boolean(x)))]
}

export function readTicket(raw: unknown): RenderTicket {
  const t = raw as Partial<RenderTicket> | null
  if (!t || t.version !== 1 || !t.assets || typeof t.assets !== 'object') throw new Error('El archivo no es un paquete de render de Cerebro Studio.')
  const composition = parseComposition(t.composition)
  if (!composition) throw new Error('El montaje del paquete no es válido.')
  if (Date.parse(t.expiresAt ?? '') < Date.now()) throw new Error('El paquete ha caducado (los enlaces duran 4 h). Genera uno nuevo desde el editor.')
  return { ...(t as RenderTicket), composition }
}
