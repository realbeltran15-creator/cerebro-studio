import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { allowedDownload, getStockItem, stockKinds, type StockKind, type StockSource } from '@/lib/providers/stock'
import { persistImportedAsset } from '@/lib/providers/persist'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Imports one item into the project's Biblioteca. The item is re-read from the bank by id so the
 * stored license, author and file always come from the provider, not from the browser.
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null) as { source?: StockSource; kind?: StockKind; id?: string; projectId?: string; sceneId?: string | null; as?: 'music' | 'sfx' } | null
  const source = body?.source, kind = body?.kind, id = body?.id?.trim(), projectId = body?.projectId?.trim()
  if (!source || !(source in stockKinds) || !kind || !stockKinds[source].includes(kind) || !id || !projectId) return NextResponse.json({ error: 'Datos de importación incompletos.' }, { status: 400 })
  const { data: project } = await supabase.from('projects').select('id').eq('id', projectId).eq('owner_id', user.id).maybeSingle()
  if (!project) return NextResponse.json({ error: 'Proyecto no encontrado.' }, { status: 404 })
  let sceneId: string | null = null
  if (body?.sceneId) {
    const { data: scene } = await supabase.from('scenes').select('id').eq('id', body.sceneId).eq('owner_id', user.id).maybeSingle()
    sceneId = scene?.id ?? null
  }
  try {
    const item = await getStockItem(source, kind, id)
    if (!allowedDownload(source, item.downloadUrl)) return NextResponse.json({ error: 'Origen del archivo no permitido.' }, { status: 400 })
    const assetKind = kind === 'audio' ? (body?.as === 'music' ? 'music' : 'sfx') : kind
    const { asset, duplicate } = await persistImportedAsset({
      ownerId: user.id, projectId, kind: assetKind, source, externalId: item.id, downloadUrl: item.downloadUrl, mimeType: item.mimeType,
      licenseStatus: item.licenseStatus, sourceUrl: item.pageUrl,
      provenance: {
        provider: source, title: item.title, author: item.author, authorUrl: item.authorUrl, license: item.license, licenseUrl: item.licenseUrl,
        attribution: item.attribution, originalUrl: item.pageUrl, durationSeconds: item.durationSeconds, width: item.width, height: item.height, sceneId,
        note: source === 'freesound' ? 'Importada la vista previa HQ (MP3); el original requiere OAuth2 en Freesound.' : null,
      },
    })
    return NextResponse.json({ asset, duplicate }, { status: duplicate ? 200 : 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo importar.' }, { status: 502 })
  }
}
