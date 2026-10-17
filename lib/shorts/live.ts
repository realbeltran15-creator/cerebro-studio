import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { catalog } from '@/lib/providers/catalog'
import { buildAvailability, loadPoolStatuses } from '@/lib/providers/availability'
import { startGeneration } from '@/lib/providers/adapters'
import { runTextTask } from '@/lib/providers/text'
import { generationProvenance } from '@/lib/providers/provenance'
import { allowedDownload, searchStock, stockConfigured } from '@/lib/providers/stock'
import { putObject, removeObject } from '@/lib/storage/server'
import type { GeneratedAsset } from '@/lib/providers/types'
import type { ShortsConfig } from './config'
import { chooseFreeModels, type FactoryDeps, type ItemRow, type MusicPick, type Store, type TextCall } from './factory'
import { fetchPublicPage } from './sources'
import type { OpportunityRow } from './topics'

/**
 * Real wiring of the factory. Text goes only to Gemini (free tier), images to Cloudflare Workers AI, voice to Gemini TTS,
 * music to Freesound (CC0 only). Every query filters by owner because the scheduled run uses the service role.
 */

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'audio/wav': 'wav', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg' }
const MAX_BYTES = { image: 25 * 1024 * 1024, voice: 50 * 1024 * 1024, music: 30 * 1024 * 1024 } as const

async function materialize(asset: GeneratedAsset, kind: keyof typeof MAX_BYTES, source: 'freesound' | null) {
  if (asset.uri.startsWith('data:')) {
    const m = asset.uri.match(/^data:([^;]+);base64,(.+)$/)
    if (!m) throw new Error('Recurso generado no válido.')
    return { bytes: Buffer.from(m[2], 'base64'), mime: m[1] }
  }
  if (!source || !allowedDownload(source, asset.uri)) throw new Error('Origen de descarga no permitido.')
  const r = await fetch(asset.uri, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(90000) })
  if (!r.ok) throw new Error(`No se pudo descargar el recurso (${r.status}).`)
  const bytes = Buffer.from(await r.arrayBuffer())
  if (!bytes.length || bytes.length > MAX_BYTES[kind]) throw new Error('El recurso es demasiado grande o está vacío.')
  return { bytes, mime: r.headers.get('content-type')?.split(';')[0] || asset.mimeType }
}

export function supabaseStore(db: SupabaseClient, ownerId: string, automationId: string | null): Store {
  const stored: string[] = []
  const fail = (what: string, e: { message: string } | null) => { throw new Error(`${what}: ${e?.message ?? 'sin respuesta'}`) }
  return {
    async saveDiscarded(i) {
      const row = { owner_id: ownerId, automation_id: automationId, opportunity_id: i.opportunityId, status: 'discarded', topic: i.topic.slice(0, 200), topic_key: i.topicKey, theme: i.theme, discarded_reason: i.reason.slice(0, 500), sources: i.sources, interest: i.interest, updated_at: new Date().toISOString() }
      const { error } = await db.from('shorts_factory_items').upsert(row, { onConflict: 'owner_id,topic_key' })
      if (error) fail('No se pudo registrar el tema descartado', error)
    },
    async createProject(name, description) {
      const { data, error } = await db.from('projects').insert({ owner_id: ownerId, name, description, status: 'draft', target_platforms: ['youtube'] }).select('id').single()
      if (error || !data) fail('No se pudo crear el proyecto', error)
      return data as { id: string }
    },
    async createScript(projectId, s) {
      const { data, error } = await db.from('scripts').insert({ owner_id: ownerId, project_id: projectId, source_opportunity_id: s.opportunityId, version: 1, title: s.title, status: 'review', idea: s.idea, brief: s.brief, hook: s.hook, cta: s.cta, sections: s.sections }).select('id').single()
      if (error || !data) fail('No se pudo crear el guion', error)
      return data as { id: string }
    },
    async createStoryboard(projectId, scriptId, title) {
      const { data, error } = await db.from('storyboards').insert({ owner_id: ownerId, project_id: projectId, script_id: scriptId, title, aspect_ratio: '9:16', version: 1 }).select('id').single()
      if (error || !data) fail('No se pudo crear el storyboard', error)
      return data as { id: string }
    },
    async createScenes(storyboardId, scenes) {
      const { data, error } = await db.from('scenes').insert(scenes.map(s => ({ owner_id: ownerId, storyboard_id: storyboardId, ...s }))).select('id,position')
      if (error || !data) fail('No se pudieron crear las escenas', error)
      return (data as Array<{ id: string; position: number }>).sort((a, b) => a.position - b.position)
    },
    async putAsset(projectId, kind, asset, extra) {
      const { bytes, mime } = await materialize(asset, kind, kind === 'music' ? 'freesound' : null)
      const path = await putObject(db, ownerId, `${ownerId}/${projectId}/shorts-${kind}-${randomUUID()}.${EXT[mime] ?? 'bin'}`, bytes, mime)
      stored.push(path)
      const { data, error } = await db.from('assets').insert({
        owner_id: ownerId, project_id: projectId, asset_type: kind, storage_path: path, source_provider: extra.provider, source_url: extra.sourceUrl ?? null, license_status: extra.license,
        provenance: { ...generationProvenance({ provider: extra.provider, requestId: randomUUID(), projectId, mimeType: mime, externalId: asset.externalId, metadata: asset.metadata }), bytes: bytes.byteLength, createdBy: 'shorts_factory', ...extra.provenance },
      }).select('id').single()
      if (error || !data) { await removeObject(db, ownerId, path).catch(() => undefined); stored.pop(); fail('No se pudo registrar el recurso', error) }
      return data as { id: string }
    },
    async createRenderJob(projectId, composition) {
      const { data, error } = await db.from('render_jobs').insert({ owner_id: ownerId, project_id: projectId, output_format: '9:16', status: 'draft', composition }).select('id').single()
      if (error || !data) fail('No se pudo crear el trabajo de render', error)
      return data as { id: string }
    },
    async saveItem(item) {
      const { data, error } = await db.from('shorts_factory_items').upsert({ owner_id: ownerId, automation_id: automationId, ...item, updated_at: new Date().toISOString() }, { onConflict: 'owner_id,topic_key' }).select('id').single()
      if (error || !data) fail('No se pudo registrar el Short', error)
      return data as { id: string }
    },
    async rollback(projectId) {
      for (const path of stored) await removeObject(db, ownerId, path).catch(() => undefined)
      if (projectId) await db.from('projects').delete().eq('id', projectId).eq('owner_id', ownerId)
    },
  }
}

export async function liveDeps(db: SupabaseClient, ownerId: string, cfg: ShortsConfig, automationId: string | null, now = new Date()): Promise<FactoryDeps> {
  const [opps, items, projects, pools] = await Promise.all([
    db.from('opportunities').select('id,title,source_id,observed_metrics,calculated_metrics').eq('owner_id', ownerId).eq('source_platform', 'youtube').neq('status', 'discarded').order('updated_at', { ascending: false }).limit(300),
    db.from('shorts_factory_items').select('topic,topic_key,theme,status,prepared_on,created_at,retention,discarded_reason').eq('owner_id', ownerId).order('created_at', { ascending: false }).limit(500),
    db.from('projects').select('name').eq('owner_id', ownerId).limit(500),
    loadPoolStatuses(db, ownerId, catalog, process.env, now),
  ])
  if (opps.error) throw new Error(opps.error.message)
  if (items.error) throw new Error(items.error.message)
  const availability = buildAvailability(catalog, process.env, pools, { jobsReady: false })
  const text: TextCall = async (task, input) => {
    const r = await runTextTask(task, { ...input, requestId: randomUUID(), only: 'gemini', minQuality: cfg.minTextQuality })
    return { data: r.data, model: r.model.id, estimatedUsd: r.estimatedUsd }
  }
  return {
    now: () => now,
    opportunities: (opps.data ?? []) as OpportunityRow[],
    items: (items.data ?? []) as ItemRow[],
    existingProjectNames: ((projects.data ?? []) as Array<{ name: string }>).map(p => p.name.replace(/^Short · /, '')),
    freeModels: scenes => chooseFreeModels(cfg, catalog, availability, scenes),
    text,
    fetchPage: url => fetchPublicPage(url),
    async generateImage(model, prompt, requestId) {
      const r = await startGeneration({ model, prompt, finalPrompt: prompt, options: { format: '9:16' }, context: { ownerId, projectId: 'shorts-factory', requestId } })
      if (r.kind !== 'assets' || !r.assets[0]) throw new Error('El proveedor no devolvió una imagen.')
      return r.assets[0]
    },
    async generateVoice(model, text, requestId) {
      const r = await startGeneration({ model, prompt: text, finalPrompt: text, options: {}, voice: cfg.voice, instructions: cfg.voiceStyle, language: 'es', context: { ownerId, projectId: 'shorts-factory', requestId } })
      if (r.kind !== 'assets' || !r.assets[0]) throw new Error('El proveedor no devolvió audio.')
      return r.assets[0]
    },
    async findMusic(query): Promise<MusicPick | null> {
      if (!stockConfigured('freesound')) return null
      const found = await searchStock('freesound', 'audio', query, { cc0Only: true, maxSeconds: 180 })
      const pick = found.find(i => i.licenseStatus === 'public_domain' && (i.durationSeconds ?? 0) >= 25 && allowedDownload('freesound', i.downloadUrl))
      return pick ? { id: pick.id, title: pick.title, author: pick.author, pageUrl: pick.pageUrl, license: pick.license, licenseUrl: pick.licenseUrl, downloadUrl: pick.downloadUrl, mimeType: pick.mimeType, durationSeconds: pick.durationSeconds, attribution: pick.attribution } : null
    },
    store: supabaseStore(db, ownerId, automationId),
  }
}
