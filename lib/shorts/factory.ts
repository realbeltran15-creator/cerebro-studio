import type { GeneratedAsset } from '@/lib/providers/types'
import { rankModels, type Availability } from '@/lib/providers/router'
import type { CatalogModel } from '@/lib/providers/catalog'
import { candidatesFromOpportunities, classifyTheme, isRepeatTopic, rankCandidates, topicTokens, type OpportunityRow, type RankedCandidate } from './topics'
import { assessSources, type FetchedPage, type SourceVerdict } from './sources'
import { parseProposal, parseScript, parseVerification, proposalPrompt, proposalSchema, scriptChecks, scriptPrompt, scriptSchema, verificationPrompt, verificationSchema, type Check, type ShortScript } from './script'
import { buildShortComposition, sceneDurations, voiceLooksRight, wavDurationMs } from './plan'
import { historyBoost, type ObservedRetention } from './retention'
import type { ShortsConfig, Theme } from './config'
import type { Composition } from '@/lib/editor/composition'
import type { TextTask } from '@/lib/providers/text'

/**
 * One Short a day, prepared on the server and never published by it. Everything outside this file is injected
 * (`FactoryDeps`), so the whole decision chain is testable without a key or a network.
 * Spending: free only. Models are chosen by the router with strategy `free_only` and the minimum qualities in the
 * configuration; if none qualifies (or a free allowance would run out mid-Short) nothing is generated and the day is skipped.
 */

export type ItemRow = { topic: string; topic_key: string; theme: Theme; status: string; prepared_on: string; created_at: string; retention: ObservedRetention | null; discarded_reason?: string | null }

export type SkipReason =
  | 'already_prepared_today' | 'quality_floor_unmet' | 'free_allowance_insufficient' | 'no_data' | 'no_proven_interest'
  | 'text_budget_exhausted' | 'all_candidates_discarded' | 'generation_failed' | 'voice_quality' | 'storage_failed'

export type Outcome =
  | { status: 'prepared'; itemId: string; projectId: string; renderJobId: string; topic: string }
  | { status: 'skipped'; reason: SkipReason; message: string }

export type TextCall = <T>(task: TextTask, input: { system: string; user: string; schema: object; schemaName: string; validate: (v: unknown) => T | null }) => Promise<{ data: T; model: string; estimatedUsd: number | null }>

export type FreeModels = { ok: true; image: CatalogModel; voice: CatalogModel } | { ok: false; reasons: string[] }

export type MusicPick = { id: string; title: string; author: string; pageUrl: string; license: string; licenseUrl: string | null; downloadUrl: string; mimeType: string; durationSeconds: number | null; attribution: string }

export type StoredAsset = { id: string }

export interface Store {
  saveDiscarded(item: { topic: string; topicKey: string; theme: Theme; reason: string; opportunityId: string | null; sources: SourceVerdict[]; interest: unknown }): Promise<void>
  createProject(name: string, description: string): Promise<{ id: string }>
  createScript(projectId: string, input: { title: string; hook: string; cta: string; idea: string; brief: string; sections: unknown[]; opportunityId: string | null }): Promise<{ id: string }>
  createStoryboard(projectId: string, scriptId: string, title: string): Promise<{ id: string }>
  createScenes(storyboardId: string, scenes: Array<{ position: number; duration_ms: number; narration: string; visual_prompt: string; metadata: Record<string, unknown> }>): Promise<Array<{ id: string; position: number }>>
  putAsset(projectId: string, kind: 'image' | 'voice' | 'music', asset: GeneratedAsset, extra: { provider: string; license: string; sourceUrl?: string | null; provenance: Record<string, unknown> }): Promise<StoredAsset>
  createRenderJob(projectId: string, composition: Composition): Promise<{ id: string }>
  saveItem(item: Record<string, unknown>): Promise<{ id: string }>
  /** Removes everything created for a project after a failure (best effort). */
  rollback(projectId: string | null): Promise<void>
}

export type FactoryDeps = {
  now: () => Date
  opportunities: OpportunityRow[]
  items: ItemRow[]
  existingProjectNames: string[]
  freeModels: (scenes: number) => FreeModels
  text: TextCall
  fetchPage: (url: string) => Promise<FetchedPage>
  generateImage: (model: CatalogModel, prompt: string, requestId: string) => Promise<GeneratedAsset>
  generateVoice: (model: CatalogModel, text: string, requestId: string) => Promise<GeneratedAsset>
  findMusic: (query: string) => Promise<MusicPick | null>
  store: Store
}

const skip = (reason: SkipReason, message: string): Outcome => ({ status: 'skipped', reason, message })
const topicKeyOf = (topic: string) => topicTokens(topic).sort().join(' ')
const DISCARD_RETRY_DAYS = 14
const IMAGE_STYLE = 'Fotografía realista vertical 9:16, iluminación cinematográfica, alto detalle, sin texto, sin letras, sin marcas de agua, sin rostros reconocibles.'

export class BudgetError extends Error {}

/** Free models that reach the minimum quality, or why none does. Pure: availability is computed by the caller. */
export function chooseFreeModels(cfg: ShortsConfig, models: CatalogModel[], availability: Record<string, Availability>, scenes: number): FreeModels {
  const reasons: string[] = []
  const img = rankModels(models, { modality: 'image', strategy: 'free_only', format: '9:16', minQuality: cfg.minImageQuality, minShortSidePx: 720 }, availability)
  const voice = rankModels(models, { modality: 'voice', strategy: 'free_only', minQuality: cfg.minVoiceQuality, needs: ['spanish'] }, availability)
  const image = img.filter(r => r.eligible).sort((a, b) => b.model.quality - a.model.quality)[0]?.model
  const voiceModel = voice.filter(r => r.eligible).sort((a, b) => b.model.quality - a.model.quality)[0]?.model
  if (!image) reasons.push(`Imagen: ninguna opción gratuita con calidad ≥ ${cfg.minImageQuality}/5 está disponible (${[...new Set(img.flatMap(r => r.reasons))].slice(0, 3).join('; ') || 'sin modelos'}).`)
  if (!voiceModel) reasons.push(`Voz: ninguna opción gratuita con calidad ≥ ${cfg.minVoiceQuality}/5 en español está disponible (${[...new Set(voice.flatMap(r => r.reasons))].slice(0, 3).join('; ') || 'sin modelos'}).`)
  if (image && image.allowanceUnits) {
    const needed = (image.allowanceUnits({ format: '9:16' }) ?? 0) * scenes
    const remaining = availability[image.id]?.remaining
    if (remaining !== undefined && remaining + 1e-9 < needed) reasons.push(`El cupo gratuito de imagen no alcanza para ${scenes} escenas (necesita ≈ ${Math.ceil(needed)} y quedan ${Math.floor(remaining)}).`)
  }
  return reasons.length || !image || !voiceModel ? { ok: false, reasons } : { ok: true, image, voice: voiceModel }
}

export async function prepareDailyShort(cfg: ShortsConfig, deps: FactoryDeps): Promise<{ outcome: Outcome; log: string[]; textCalls: number }> {
  const log: string[] = []
  let textCalls = 0
  const say = (m: string) => { log.push(m) }
  const today = deps.now().toISOString().slice(0, 10)
  const done = (outcome: Outcome) => ({ outcome, log, textCalls })

  // 0. One a day.
  if (deps.items.some(i => i.prepared_on === today && i.status !== 'discarded' && i.status !== 'failed')) {
    return done(skip('already_prepared_today', 'Ya hay un Short preparado hoy.'))
  }

  // 1. Quality floor first: if free cannot reach it, do not spend a single text call.
  const sceneBudget = cfg.scenes.max
  const free = deps.freeModels(sceneBudget)
  if (!free.ok) return done(skip(free.reasons.some(r => r.includes('cupo')) ? 'free_allowance_insufficient' : 'quality_floor_unmet', `No se crea el Short hoy: ${free.reasons.join(' ')}`))

  // 2. Proven interest from Radar.
  const previousTopics = [
    // A topic the owner discarded stays out for good; one the factory discarded (no sources, failed script) may be retried after two weeks.
    ...deps.items.filter(i => i.status !== 'discarded' || /^Descartado por/.test(i.discarded_reason ?? '') || Date.parse(i.created_at) > deps.now().getTime() - DISCARD_RETRY_DAYS * 86400000).map(i => i.topic),
    ...deps.existingProjectNames,
  ]
  const boost = historyBoost(deps.items.map(i => ({ theme: i.theme, retention: i.retention })))
  const { ranked, nicheMedian, poolSize, blocker } = rankCandidates(candidatesFromOpportunities(deps.opportunities), cfg, { previousTopics, history: boost })
  say(`Radar: ${poolSize} vídeos con vistas, mediana del nicho ${nicheMedian ? Math.round(nicheMedian) : 'n/d'}.`)
  const proven = ranked.filter(r => r.provenInterest)
  if (!proven.length) return done(skip(poolSize < cfg.minPoolSize ? 'no_data' : 'no_proven_interest', `No se crea el Short hoy: ${blocker ?? 'sin interés comprobado.'}`))

  const call: TextCall = async (task, input) => {
    if (textCalls >= cfg.maxTextCalls) throw new BudgetError('Tope diario de llamadas de texto alcanzado.')
    textCalls++
    return deps.text(task, input)
  }

  const discardedTopics: string[] = []
  for (let attempt = 0; attempt < Math.min(cfg.maxCandidatesPerDay, proven.length); attempt++) {
    const lead = proven[attempt]
    const titles = proven.slice(attempt, attempt + 4).map(r => r.candidate.title)
    try {
      // 3. Proposal, repeat check, source assessment, verification.
      const p = proposalPrompt(cfg, titles, [...previousTopics, ...discardedTopics])
      const proposal = (await call('analysis', { ...p, schema: proposalSchema, schemaName: 'short_proposal', validate: parseProposal })).data
      const topicKey = topicKeyOf(proposal.topic)
      const theme = classifyTheme(`${proposal.topic} ${proposal.statement}`)
      if (isRepeatTopic(proposal.topic, [...previousTopics, ...discardedTopics])) { say(`«${proposal.topic}»: tema repetido, descartado.`); discardedTopics.push(proposal.topic); continue }
      const assessed = await assessSources(proposal.sources, proposal.keyTerms, deps.fetchPage, { extraReliable: cfg.extraReliableDomains })
      say(`«${proposal.topic}»: ${assessed.accepted.length} fuente(s) aceptada(s) de ${assessed.verdicts.length}.`)
      const discard = async (reason: string) => {
        discardedTopics.push(proposal.topic)
        await deps.store.saveDiscarded({ topic: proposal.topic, topicKey, theme, reason, opportunityId: lead.candidate.opportunityId, sources: assessed.verdicts, interest: interestEvidence(lead, nicheMedian, poolSize) })
      }
      if (!assessed.ok) { await discard('Menos de 2 fuentes fiables que contengan el dato.'); continue }
      const verification = (await call('analysis', { ...verificationPrompt(proposal.statement, assessed.accepted.map(s => ({ domain: s.domain, excerpt: s.excerpt ?? '' }))), schema: verificationSchema, schemaName: 'short_verification', validate: parseVerification })).data
      if (!verification.supported) { await discard(`Las fuentes no respaldan el dato: ${verification.contradictions.join('; ') || verification.note || 'sin detalle'}`); continue }

      // 4. Script and the hard controls.
      const excerpts = assessed.accepted.map(s => s.excerpt ?? '')
      const verifiedText = [proposal.statement, ...excerpts].join(' ')
      let script: ShortScript | null = null
      let checks: Check[] = []
      let feedback: string[] = []
      for (let tryNo = 0; tryNo < 2 && !script; tryNo++) {
        const sp = scriptPrompt(cfg, { statement: proposal.statement, keyTerms: proposal.keyTerms }, excerpts, feedback)
        const candidate = (await call('script_hooks', { ...sp, schema: scriptSchema, schemaName: 'short_script', validate: parseScript })).data
        const result = scriptChecks(candidate, { keyTerms: proposal.keyTerms }, verifiedText, cfg)
        checks = result.checks
        if (result.ok) script = candidate
        else feedback = result.checks.filter(c => !c.ok).map(c => c.message)
      }
      if (!script) { await discard(`El guion no pasa los controles: ${feedback.join(' | ')}`); continue }

      // 5. Free generation. Nothing is stored until everything has been generated.
      const requestBase = `shorts-${today}-${topicKey.replace(/\s+/g, '-').slice(0, 40)}`
      const narration = script.scenes.map(s => s.narration).join('\n')
      const freeNow = deps.freeModels(script.scenes.length)
      if (!freeNow.ok) return done(skip('free_allowance_insufficient', `No se crea el Short hoy: ${freeNow.reasons.join(' ')}`))
      let voice: GeneratedAsset
      try { voice = await deps.generateVoice(freeNow.voice, narration, `${requestBase}-voice`) } catch (e) { return done(skip('generation_failed', `La voz gratuita falló: ${msg(e)}`)) }
      const voiceBytes = dataBytes(voice.uri)
      const audioMs = voiceBytes ? wavDurationMs(voiceBytes) : null
      if (!voiceLooksRight(audioMs, estimated(script))) return done(skip('voice_quality', `No se crea el Short hoy: la voz generada no tiene una duración coherente con el guion (${audioMs === null ? 'ilegible' : Math.round(audioMs / 1000) + ' s'}).`))
      const images: GeneratedAsset[] = []
      for (const [i, scene] of script.scenes.entries()) {
        try { images.push(await deps.generateImage(freeNow.image, `${scene.visual}. ${IMAGE_STYLE}`, `${requestBase}-img${i + 1}`)) } catch (e) { return done(skip('generation_failed', `La imagen gratuita ${i + 1} falló: ${msg(e)}`)) }
      }
      const music = await deps.findMusic(cfg.musicQuery).catch(() => null)

      // 6. Persist: project → script → storyboard → scenes → assets → composition → item. Roll back on any failure.
      let projectId: string | null = null
      try {
        const project = await deps.store.createProject(`Short · ${proposal.topic}`.slice(0, 120), `${cfg.channelName}: ${proposal.statement}`.slice(0, 500))
        projectId = project.id
        const sections = script.scenes.map((s, i) => ({ id: `sec-${i + 1}`, heading: i === 0 ? 'Gancho + dato' : `Escena ${i + 1}`, basis: 'verified_fact', text: s.narration, sources: assessed.accepted.map(a => a.url), speaker: null }))
        const scriptRow = await deps.store.createScript(project.id, { title: script.title, hook: script.scenes[0].narration, cta: script.scenes[script.scenes.length - 1].narration, idea: proposal.statement, brief: `Short de curiosidades para ${cfg.channelName}. Fuentes: ${assessed.accepted.map(a => a.url).join(' · ')}`, sections, opportunityId: lead.candidate.opportunityId })
        const board = await deps.store.createStoryboard(project.id, scriptRow.id, script.title)
        const durations = sceneDurations(script.scenes.map(s => s.narration), audioMs!)
        const scenes = await deps.store.createScenes(board.id, script.scenes.map((s, i) => ({ position: i + 1, duration_ms: durations[i], narration: s.narration, visual_prompt: `${s.visual}. ${IMAGE_STYLE}`, metadata: { onScreenText: s.onScreenText, basis: 'verified_fact', sources: assessed.accepted.map(a => a.url), shorts_factory: true } })))
        const voiceAsset = await deps.store.putAsset(project.id, 'voice', voice, { provider: voice.provider, license: 'generated', provenance: { model: freeNow.voice.id, voice: cfg.voice, costTier: 'free', purpose: 'shorts_factory_narration', durationMs: audioMs } })
        const imageAssets: StoredAsset[] = []
        for (const [i, img] of images.entries()) {
          const units = freeNow.image.allowanceUnits?.({ format: '9:16' })
          imageAssets.push(await deps.store.putAsset(project.id, 'image', img, { provider: img.provider, license: 'generated', provenance: { model: freeNow.image.id, costTier: 'free', sceneId: scenes[i]?.id ?? null, prompt: script.scenes[i].visual, ...(freeNow.image.allowance ? { allowancePool: freeNow.image.allowance.pool, allowanceUnits: units ?? 0 } : {}) } }))
        }
        let musicAsset: StoredAsset | null = null
        if (music) musicAsset = await deps.store.putAsset(project.id, 'music', { provider: 'freesound', mimeType: music.mimeType, uri: music.downloadUrl, externalId: `freesound:${music.id}` }, { provider: 'freesound', license: 'public_domain', sourceUrl: music.pageUrl, provenance: { title: music.title, author: music.author, license: music.license, licenseUrl: music.licenseUrl, attribution: music.attribution, externalId: `freesound:${music.id}`, costTier: 'free' } })
        const composition = buildShortComposition({ storyboardId: board.id, title: script.title, script, scenes, durationsMs: scenes.map((s, i) => durations[s.position - 1] ?? durations[i]), imageAssetIds: scenes.map((_, i) => imageAssets[i]?.id ?? null), voiceAssetId: voiceAsset.id, audioMs: audioMs!, musicAssetId: musicAsset?.id ?? null })
        const job = await deps.store.createRenderJob(project.id, composition)
        const item = await deps.store.saveItem({
          status: 'prepared', project_id: project.id, render_job_id: job.id, opportunity_id: lead.candidate.opportunityId, topic: proposal.topic, topic_key: topicKey, theme, prepared_on: today,
          interest: interestEvidence(lead, nicheMedian, poolSize), sources: assessed.verdicts, verification: { ...verification, statement: proposal.statement, keyTerms: proposal.keyTerms },
          checks, plan: { title: script.title, description: script.description, hashtags: script.hashtags, scenes: script.scenes.length, seconds: Math.round(audioMs! / 1000), music: music ? { id: music.id, author: music.author, license: music.license } : null, musicMissing: !music },
          spend: { usd: 0, textCalls, imageCalls: images.length, voiceCalls: 1, tier: 'free', models: { image: freeNow.image.id, voice: freeNow.voice.id }, note: 'Solo modelos con nivel gratuito; la factura real depende de que la cuenta del proveedor no tenga facturación activa.' },
          discarded_reason: null,
        })
        say(`Preparado: «${proposal.topic}».`)
        return done({ status: 'prepared', itemId: item.id, projectId: project.id, renderJobId: job.id, topic: proposal.topic })
      } catch (e) {
        await deps.store.rollback(projectId).catch(() => undefined)
        return done(skip('storage_failed', `No se pudo guardar el Short: ${msg(e)}`))
      }
    } catch (e) {
      if (e instanceof BudgetError) return done(skip('text_budget_exhausted', 'Se alcanzó el tope diario de llamadas de texto antes de tener un Short verificado.'))
      say(`Intento ${attempt + 1} fallido: ${msg(e)}`)
      if (attempt === Math.min(cfg.maxCandidatesPerDay, proven.length) - 1) return done(skip('all_candidates_discarded', `Todos los temas probados se descartaron o fallaron (último error: ${msg(e)}).`))
    }
  }
  return done(skip('all_candidates_discarded', 'Todos los temas probados se descartaron (repetidos, sin fuentes fiables o con un guion que no pasa los controles).'))
}

function interestEvidence(r: RankedCandidate, nicheMedian: number | null, poolSize: number) {
  return {
    video: { title: r.candidate.title, url: r.candidate.url, channel: r.candidate.channelTitle, views: r.candidate.views, kind: 'observed' },
    nicheMedianViews: nicheMedian, poolSize, theme: r.theme, components: r.components, score: r.score,
    labels: 'views: observado (YouTube Data API) · razón y tendencia: calculado · historial: inferido',
  }
}

const msg = (e: unknown) => (e instanceof Error ? e.message : 'error').slice(0, 200)
const estimated = (s: ShortScript) => Math.round(s.scenes.map(x => x.narration).join(' ').split(/\s+/).filter(Boolean).length / 2.5)
function dataBytes(uri: string) {
  const m = uri.match(/^data:[^;]+;base64,(.+)$/)
  return m ? new Uint8Array(Buffer.from(m[1], 'base64')) : null
}
