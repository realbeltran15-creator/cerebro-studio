import type { SupabaseClient } from '@supabase/supabase-js'
import { generateImage } from './cloudflare'
import { pipelineMissing } from './env'
import { FreeTierExhausted, generateJson, synthesizeSpeech } from './gemini'
import {
  allocateTimes, audioGates, chunkWords, evaluateInterest, hookGates, isSameTopic, scoreCandidate, scriptGates, snapToPauses, sourceGate,
} from './gates'
import { loadRetention } from './metrics'
import { enrichOpportunity, ideateTopics, loadCandidates, YouTubeQuotaError } from './radar'
import { verifySources } from './sources'
import { DEFAULT_CONFIG, type Facts, type FactoryConfig, type GateResult, type Manifest, type Script } from './types'

export type PrepareResult =
  | { status: 'blocked'; missing: string[] }
  | { status: 'disabled' }
  | { status: 'exists'; shortId: string; shortStatus: string }
  | { status: 'discarded'; shortId: string; reason: string; detail: Record<string, unknown> }
  | { status: 'ready'; shortId: string }

class Discard extends Error {
  constructor(public reason: string, public detail: Record<string, unknown> = {}) { super(reason) }
}

export const todayInMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())

async function loadAutomation(db: SupabaseClient, ownerId: string) {
  const { data } = await db.from('automations').select('id,enabled,config').eq('owner_id', ownerId).eq('kind', 'shorts_factory').limit(1).maybeSingle()
  if (data) return data as { id: string; enabled: boolean; config: Record<string, any> }
  const { data: created } = await db.from('automations').insert({
    owner_id: ownerId, kind: 'shorts_factory', name: 'Fábrica de Shorts de curiosidades · Umbral del Hito',
    // 'manual' a propósito: el cron genérico de automatizaciones (schedule='daily') no debe ejecutarla; tiene su propio cron.
    enabled: true, schedule: 'manual', config: { factory: {} },
  }).select('id,enabled,config').single()
  return created as { id: string; enabled: boolean; config: Record<string, any> } | null
}

export const mergeConfig = (overrides: Partial<FactoryConfig> | undefined): FactoryConfig => ({ ...DEFAULT_CONFIG, ...(overrides ?? {}) })

type Fit = { fits?: { index: number; fit: number; category: string }[] }

export async function chooseFacts(topic: string, config: FactoryConfig) {
  const proposal = await generateJson<{ claim?: string; key_datum?: string; candidate_urls?: string[] }>(
    `Tema de curiosidad para un Short: «${topic}». Idioma de salida: ${config.language}.\n` +
    `Elige UN dato concreto, sorprendente y VERIFICABLE sobre el tema, del que estés muy seguro (con cifra o hecho preciso). Si no hay un dato fiable, devuelve claim="".\n` +
    `Devuelve JSON {"claim": frase precisa en español, "key_datum": el dato clave en ≤4 palabras tal como se dirá en voz (p. ej. "tres corazones", "400 veces"), ` +
    `"candidate_urls": 5-6 URLs de páginas CONCRETAS (no portadas) en dominios fiables e independientes entre sí (enciclopedias, agencias científicas o institucionales, revistas de divulgación consolidadas)}.`,
    0.4,
  )
  if (!proposal.claim?.trim() || !proposal.key_datum?.trim()) throw new Discard('sin_dato_verificable', { topic })
  const { sources, checked } = await verifySources(proposal.claim, proposal.candidate_urls ?? [], config)
  return { claim: proposal.claim.trim(), key_datum: proposal.key_datum.trim(), sources, checked }
}

export async function writeScript(topic: string, facts: Facts, config: FactoryConfig, feedback: string[]) {
  return generateJson<Script>(
    `Escribe el guion de un YouTube Short de ${config.minDuration + 8}-40 segundos para el canal «${config.channelName}». Tono: ${config.tone}. Idioma: ${config.language} (España).\n` +
    `Tema: ${topic}\nDATO VERIFICADO (no cambies cifras ni lo amplíes con otros datos): ${facts.claim}\nDato clave: «${facts.key_datum}»\n` +
    `Reglas:\n- "hook": máximo ${config.maxHookWords} palabras, se dice en menos de ${config.hookSeconds} s y DEBE contener literalmente «${facts.key_datum}» y nombrar el sujeto (nada de «¿Sabías que…?» sin sujeto).\n` +
    `- "beats": entre 4 y 6 escenas; cada una 1-2 frases cortas que desarrollan solo el dato verificado. La última cierra con una pregunta o idea redonda, sin pedir suscripción.\n` +
    `- Total de palabras (hook + beats) entre 60 y 100. Sin exageraciones ni promesas falsas.\n` +
    `- "visual_prompt" de cada escena en INGLÉS: ilustración o fotografía cinematográfica, composición vertical con el sujeto centrado, sin texto, sin logotipos, sin personas reales reconocibles.\n` +
    `- "category": una de [${config.categories.join(', ')}]. "title": ≤90 caracteres, honesto, sin clickbait falso. "description": 1-2 frases + #Shorts. "tags": 5-8 etiquetas.\n` +
    (feedback.length ? `Corrige estos fallos de la versión anterior: ${feedback.join('; ')}.\n` : '') +
    `Devuelve JSON {"hook": string, "key_datum": "${facts.key_datum}", "beats": [{"text": string, "visual_prompt": string}], "category": string, "title": string, "description": string, "tags": string[]}.`,
    0.6,
  )
}

const failing = (gates: GateResult[]) => gates.filter(g => !g.pass).map(g => `${g.name}: ${g.detail}`)

async function upload(db: SupabaseClient, path: string, bytes: Uint8Array, contentType: string) {
  const { error } = await db.storage.from('shorts-assets').upload(path, bytes, { contentType, upsert: true })
  if (error) throw new Error(`Storage: ${error.message}`)
}

export async function prepareDailyShort(db: SupabaseClient, ownerId: string, opts: { force?: boolean; today?: string } = {}): Promise<PrepareResult> {
  const missing = pipelineMissing()
  if (missing.length) return { status: 'blocked', missing: [...missing] }

  const automation = await loadAutomation(db, ownerId)
  if (!automation?.enabled) return { status: 'disabled' }
  const config = mergeConfig(automation.config?.factory)
  const runDate = opts.today ?? todayInMadrid()

  const { data: live } = await db.from('shorts').select('id,status').eq('owner_id', ownerId).eq('run_date', runDate).neq('status', 'discarded').maybeSingle()
  if (live) return { status: 'exists', shortId: live.id, shortStatus: live.status }
  if (!opts.force) {
    const { data: tried } = await db.from('shorts').select('id,discard_reason,discard_detail').eq('owner_id', ownerId).eq('run_date', runDate).eq('status', 'discarded').limit(1).maybeSingle()
    if (tried) return { status: 'discarded', shortId: tried.id, reason: tried.discard_reason ?? 'descartado', detail: tried.discard_detail ?? {} }
  }

  const { data: claim, error: claimError } = await db.from('shorts').insert({ owner_id: ownerId, run_date: runDate, status: 'preparing' }).select('id').single()
  if (claimError || !claim) {
    // Carrera con otra ejecución del mismo día: el índice único la bloquea.
    const { data: other } = await db.from('shorts').select('id,status').eq('owner_id', ownerId).eq('run_date', runDate).neq('status', 'discarded').maybeSingle()
    if (other) return { status: 'exists', shortId: other.id, shortStatus: other.status }
    throw new Error(claimError?.message ?? 'No se pudo reservar el Short del día')
  }
  const shortId = claim.id as string
  const { data: run } = await db.from('automation_runs').insert({ owner_id: ownerId, automation_id: automation.id, trigger: opts.force ? 'manual' : 'schedule', status: 'running' }).select('id').single()
  const finishRun = async (status: 'succeeded' | 'failed', summary: Record<string, unknown>, error?: string) => {
    const now = new Date().toISOString()
    if (run) await db.from('automation_runs').update({ status, summary, error: error ?? null, finished_at: now }).eq('id', run.id)
    await db.from('automations').update({ last_run_at: now }).eq('id', automation.id)
  }

  try {
    // ---------- 1) Elegir tema ----------
    const { data: used } = await db.from('shorts').select('topic_key,topic').eq('owner_id', ownerId).neq('status', 'discarded').not('topic_key', 'is', null)
    const usedKeys = new Set((used ?? []).map(u => u.topic_key as string))
    const isUsed = (key: string) => [...usedKeys].some(u => u === key || isSameTopic(u, key))

    let candidates = (await loadCandidates(db, ownerId, new Set())).filter(c => !isUsed(c.topicKey))
    const withData = () => candidates.filter(c => c.interest).length
    const enrichQueue = () => candidates.filter(c => !c.interest).slice(0, 8)
    const evaluated: { title: string; pass: boolean; reason: string }[] = []

    try {
      if (withData() + enrichQueue().length < 4) {
        await ideateTopics(db, ownerId, config, [...(used ?? []).map(u => u.topic as string), ...candidates.map(c => c.title)])
        candidates = (await loadCandidates(db, ownerId, new Set())).filter(c => !isUsed(c.topicKey))
      }
      for (const c of enrichQueue()) {
        c.interest = await enrichOpportunity(db, ownerId, c.raw, config, { id: automation.id, nicheCache: automation.config?.niche_cache })
      }
    } catch (e) {
      if (!(e instanceof YouTubeQuotaError) && !(e instanceof FreeTierExhausted)) throw e
      if (!withData()) throw new Discard('cuota_gratuita_agotada', { service: e instanceof YouTubeQuotaError ? 'YouTube Data API' : 'Gemini' })
    }

    const eligible = candidates.filter(c => {
      const r = evaluateInterest(c.interest, config)
      evaluated.push({ title: c.title, pass: r.pass, reason: r.reason })
      return r.pass
    })
    if (!eligible.length) throw new Discard('sin_interes_comprobado', { evaluated: evaluated.slice(0, 15), regla: 'vídeos similares ≥ mediana del nicho, ≥5 muestras y tendencia no a la baja' })

    const retention = await loadRetention(db, ownerId)
    const shortlist = eligible
      .map(c => ({ c, pre: scoreCandidate(c, null, null, retention, config).total }))
      .sort((a, b) => b.pre - a.pre).slice(0, 5).map(x => x.c)

    const fit = await generateJson<Fit>(
      `Canal «${config.channelName}»: ${config.nicheDescription} Tono: ${config.tone}.\nPuntúa de 0 a 10 el ENCAJE de cada tema con el canal (¿es una curiosidad concreta, verificable y apta para 30 s?) y asigna categoría de [${config.categories.join(', ')}].\n` +
      shortlist.map((c, i) => `${i}. ${c.title}`).join('\n') + `\nJSON {"fits":[{"index":number,"fit":number,"category":string}]}`,
      0.2,
    )
    const ranked = shortlist.map((c, i) => {
      const f = fit.fits?.find(x => x.index === i)
      return { c, category: f && config.categories.includes(f.category) ? f.category : null, fit: f?.fit ?? null }
    })
      .filter(x => x.fit != null && x.fit >= config.minFitScore)
      .map(x => ({ ...x, score: scoreCandidate(x.c, x.fit, x.category, retention, config) }))
      .sort((a, b) => b.score.total - a.score.total)
    if (!ranked.length) throw new Discard('sin_encaje_con_el_canal', { shortlist: shortlist.map(c => c.title), fit: fit.fits ?? [] })

    // ---------- 2) Dato verificable con ≥2 fuentes ----------
    let chosen: (typeof ranked)[number] | null = null
    let facts: Facts | null = null
    const attempts: { topic: string; sources: number; checked: unknown }[] = []
    for (const cand of ranked.slice(0, config.maxTopicsTried)) {
      const f = await chooseFacts(cand.c.title, config).catch(e => { if (e instanceof Discard) return null; throw e })
      attempts.push({ topic: cand.c.title, sources: f?.sources.length ?? 0, checked: f?.checked ?? 'sin dato verificable' })
      if (f && sourceGate(f.sources).pass) { chosen = cand; facts = { claim: f.claim, key_datum: f.key_datum, sources: f.sources }; break }
      const { data: opp } = await db.from('opportunities').select('evidence').eq('id', cand.c.opportunityId).maybeSingle()
      await db.from('opportunities').update({
        status: 'discarded', updated_at: new Date().toISOString(),
        evidence: [...(Array.isArray(opp?.evidence) ? opp.evidence : []), { source: 'shorts_factory', note: 'Descartado: no hay dato con ≥2 fuentes fiables verificadas', captured_at: new Date().toISOString() }],
      }).eq('id', cand.c.opportunityId).eq('owner_id', ownerId)
    }
    if (!chosen || !facts) throw new Discard('sin_dos_fuentes_fiables', { attempts })

    // ---------- 3) Guion + controles del hook ----------
    let script = await writeScript(chosen.c.title, facts, config, [])
    script.key_datum = facts.key_datum
    let gates: GateResult[] = [...hookGates(script, config), ...scriptGates(script, config)]
    if (failing(gates).length) {
      script = await writeScript(chosen.c.title, facts, config, failing(gates))
      script.key_datum = facts.key_datum
      gates = [...hookGates(script, config), ...scriptGates(script, config)]
    }
    if (failing(gates).length) throw new Discard('guion_bajo_calidad_minima', { gates })

    // ---------- 4) Voz (Gemini TTS gratis) + control del hook medido ----------
    const narration = [script.hook, ...script.beats.map(b => b.text)].join(' ')
    const voice = await synthesizeSpeech(narration, config.voiceName)
    const audio = audioGates(script.hook, narration, voice.seconds, config)
    gates = [...gates, ...audio, sourceGate(facts.sources)]
    if (failing(audio).length) throw new Discard('audio_bajo_calidad_minima', { gates: audio })

    // ---------- 5) Imágenes (Cloudflare Workers AI gratis): todas o ninguna ----------
    const base = `${ownerId}/${shortId}`
    const scenes: Manifest['scenes'] = []
    const texts = script.beats.map((b, i) => (i === 0 ? `${script.hook} ${b.text}` : b.text))
    const total = voice.seconds + 0.8
    // Cortes de escena: primero por caracteres (inferido) y luego anclados a las pausas reales de la voz cuando existen.
    const proportional = allocateTimes(texts, total)
    const cuts = snapToPauses(proportional.slice(0, -1).map(t => t.end), voice.pauses ?? [])
    const bounds = [0, ...cuts, total]
    const sceneTimes = texts.map((text, i) => ({ text, start: bounds[i], end: bounds[i + 1] }))
    const snapped = cuts.filter((c, i) => Math.abs(c - proportional[i].end) > 0.001).length
    for (let i = 0; i < script.beats.length; i++) {
      const img = await generateImage(`${script.beats[i].visual_prompt}. Vertical 9:16 composition, subject centered, cinematic lighting, highly detailed, no text, no letters, no watermark.`)
      const imagePath = `${base}/scene-${i}.${img.mime === 'image/png' ? 'png' : 'jpg'}`
      await upload(db, imagePath, img.bytes, img.mime)
      const t = sceneTimes[i]
      const captions = allocateTimes(chunkWords(texts[i]), t.end - t.start, t.start)
      scenes.push({ index: i, text: texts[i], image_path: imagePath, start: t.start, end: t.end, captions })
    }
    const voicePath = `${base}/voice.wav`
    await upload(db, voicePath, voice.wav, 'audio/wav')

    const manifest: Manifest = {
      width: 1080, height: 1920, fps: 30, duration: total, voice_path: voicePath, voice_duration: voice.seconds,
      scenes, hook: { text: script.hook, key_datum: facts.key_datum, overlay_until: Math.min(2.6, voice.seconds) },
      music: { kind: 'procedural', seed: Math.floor(Date.now() / 1000) % 100000, license: 'Generada proceduralmente en el navegador (Web Audio); sin material de terceros ni derechos de autor ajenos.' },
      timing_basis: snapped ? 'scene_cuts_snapped_to_voice_pauses' : 'inferred_from_characters',
    }

    const sourcesText = facts.sources.map(s => `• ${s.title ?? s.domain}: ${s.url}`).join('\n')
    const description = `${script.description}\n\nFuentes:\n${sourcesText}\n\nContenido sintético: imágenes y voz generadas con IA.`
    await db.from('shorts').update({
      status: 'ready_for_approval', opportunity_id: chosen.c.opportunityId, topic: chosen.c.title, topic_key: chosen.c.topicKey, category: script.category,
      topic_selection: { score: chosen.score, evaluated: evaluated.slice(0, 20), fit_basis: 'inferred (Gemini)', attempts },
      facts, script, manifest, quality: { gates, all_pass: failing(gates).length === 0, evaluated_at: new Date().toISOString() },
      title: script.title.slice(0, 100), description: description.slice(0, 4900), tags: (script.tags ?? []).slice(0, 10),
      updated_at: new Date().toISOString(),
    }).eq('id', shortId).eq('owner_id', ownerId)
    await db.from('opportunities').update({ status: 'experiment_approved', updated_at: new Date().toISOString() }).eq('id', chosen.c.opportunityId).eq('owner_id', ownerId)
    await finishRun('succeeded', { short_id: shortId, topic: chosen.c.title })
    return { status: 'ready', shortId }
  } catch (e) {
    const discard = e instanceof Discard
      ? e
      : e instanceof FreeTierExhausted
        ? new Discard('cuota_gratuita_agotada', { message: e.message })
        : new Discard('error_tecnico', { message: e instanceof Error ? e.message : String(e) })
    await db.from('shorts').update({ status: 'discarded', discard_reason: discard.reason, discard_detail: discard.detail, updated_at: new Date().toISOString() }).eq('id', shortId).eq('owner_id', ownerId)
    await finishRun(discard.reason === 'error_tecnico' ? 'failed' : 'succeeded', { short_id: shortId, discarded: discard.reason }, discard.reason === 'error_tecnico' ? String(discard.detail.message ?? '') : undefined)
    return { status: 'discarded', shortId, reason: discard.reason, detail: discard.detail }
  }
}
