/**
 * One entry point per provider. The Creation Studio routes only call `startGeneration` and
 * `pollGeneration`; adding a provider means adding a case here plus its catalogue entries.
 */
import { falEndpoint, falInput, falOutputs, imageDimensions, type CatalogModel, type GenerationOptions } from '../catalog'
import { falResult, falStatus, falSubmit, type FalJob } from '../fal-queue'
import { OpenAIImageProvider } from '../openai-image'
import { composeMusic, generateSoundEffect, synthesizeWithSettings, type VoiceSettings } from '../elevenlabs'
import { synthesizeSteerable } from '../openai-voice'
import { cloudflareFlux2Image, cloudflareImage, cloudflareSpeech } from '../cloudflare'
import { geminiImage, geminiSpeech, veoDownload, veoStatus, veoSubmit, type VeoJob } from '../gemini'
import { wanModelName, wanStatus, wanSubmit, type WanJob } from '../dashscope'
import { topmediaiSpeech } from '../topmediai'
import { shrinkReference, type ReferenceImage } from '../references'
import { sizeForFormat } from '../image-presets'
import { higgsfieldInput, higgsfieldStatus, higgsfieldSubmit, type HiggsfieldJob } from '../higgsfield'
import type { GeneratedAsset, ProviderContext } from '../types'

export type GenerationInput = {
  model: CatalogModel
  prompt: string
  finalPrompt: string
  negative?: string
  options: GenerationOptions
  voice?: string
  voiceSettings?: VoiceSettings
  instructions?: string
  language?: string
  /** Reference images already loaded and ownership-checked (character consistency). */
  references?: ReferenceImage[]
  context: ProviderContext
}

/** A queued job; serialised (encrypted) into the token the page polls with. */
export type JobRef = { provider: 'fal'; fal: FalJob } | { provider: 'gemini'; veo: VeoJob } | { provider: 'higgsfield'; hf: HiggsfieldJob } | { provider: 'alibaba'; wan: WanJob }

export type StartResult = { kind: 'assets'; assets: GeneratedAsset[] } | { kind: 'job'; job: JobRef; externalId: string }

export type PollMedia = { uri: string; mimeType: string; externalId: string }
export type PollResult = { state: 'queued' | 'running'; position?: number | null } | { state: 'done'; media: PollMedia[] } | { state: 'failed'; error: string }

export async function startGeneration(input: GenerationInput): Promise<StartResult> {
  const { model, prompt, finalPrompt, options, context } = input
  const format = options.format ?? '16:9'
  switch (model.provider) {
    case 'fal': {
      const job = await falSubmit(falEndpoint(model), falInput(model, finalPrompt, options, input.negative))
      return { kind: 'job', job: { provider: 'fal', fal: job }, externalId: job.requestId }
    }
    case 'higgsfield': {
      const path = model.id.slice('higgsfield:'.length)
      const hf = await higgsfieldSubmit(path, higgsfieldInput(path, finalPrompt, { format, durationSeconds: options.durationSeconds, variants: options.variants, negative: input.negative }), context.requestId)
      return { kind: 'job', job: { provider: 'higgsfield', hf }, externalId: hf.requestId }
    }
    case 'alibaba': {
      if (model.modality !== 'video') break
      const fmt = (['16:9', '9:16', '1:1'] as const).find(f => f === format) ?? '16:9'
      const wan = await wanSubmit(wanModelName(model.id), finalPrompt, { format: fmt, durationSeconds: 5, negativePrompt: input.negative })
      return { kind: 'job', job: { provider: 'alibaba', wan }, externalId: wan.taskId }
    }
    case 'topmediai':
      if (model.modality === 'voice') return { kind: 'assets', assets: [await topmediaiSpeech(context, prompt, input.voice ?? '', input.instructions)] }
      break
    case 'gemini': {
      if (model.modality === 'image') {
        const aspectRatio = (['16:9', '9:16', '1:1'] as const).find(f => f === format) ?? '16:9'
        return { kind: 'assets', assets: [await geminiImage(context, model.id.slice('gemini:'.length), finalPrompt, { aspectRatio, references: input.references })] }
      }
      if (model.modality === 'voice') return { kind: 'assets', assets: [await geminiSpeech(context, prompt, input.voice ?? 'Charon', input.instructions)] }
      if (model.modality === 'video') {
        const id = model.id.slice('gemini:'.length)
        const duration = ([4, 6, 8] as const).find(d => d === options.durationSeconds) ?? 8
        const veo = await veoSubmit(id, finalPrompt, { aspectRatio: format === '9:16' ? '9:16' : '16:9', durationSeconds: duration, negativePrompt: input.negative })
        return { kind: 'job', job: { provider: 'gemini', veo }, externalId: veo.operation.split('/').pop()! }
      }
      break
    }
    case 'cloudflare':
      if (model.modality === 'image') {
        const name = model.id.slice('cloudflare:'.length)
        if (name === '@cf/black-forest-labs/flux-2-klein-4b' || name === '@cf/black-forest-labs/flux-2-klein-9b') {
          // Workers AI takes references of at most 512×512: shrink them here so the browser never has to.
          const refs = await Promise.all((input.references ?? []).slice(0, 4).map(r => shrinkReference(r, 512)))
          const d = imageDimensions[format]
          return { kind: 'assets', assets: [await cloudflareFlux2Image(context, name, finalPrompt, { width: d.width, height: d.height, references: refs })] }
        }
        return { kind: 'assets', assets: [await cloudflareImage(context, finalPrompt)] }
      }
      if (model.modality === 'voice') return { kind: 'assets', assets: [await cloudflareSpeech(context, prompt, input.language ?? 'es')] }
      break
    case 'openai':
      if (model.modality === 'image') return { kind: 'assets', assets: [await new OpenAIImageProvider().generateImage(context, finalPrompt, { model: model.id.slice('openai:'.length), size: sizeForFormat(format), quality: options.quality === 'high' ? 'high' : 'medium', references: input.references })] }
      if (model.modality === 'voice') return { kind: 'assets', assets: [await synthesizeSteerable(context, prompt, input.voice ?? 'onyx', input.instructions)] }
      break
    case 'elevenlabs':
      if (model.modality === 'voice') {
        const voice = input.voice?.trim() || process.env.ELEVENLABS_VOICE_ID?.trim() || ''
        return { kind: 'assets', assets: [await synthesizeWithSettings(context, prompt, voice, input.voiceSettings)] }
      }
      if (model.modality === 'music') return { kind: 'assets', assets: [await composeMusic(context, finalPrompt, options.durationSeconds ?? 30, options.instrumental !== false)] }
      if (model.modality === 'sfx') return { kind: 'assets', assets: [await generateSoundEffect(context, finalPrompt, options.durationSeconds)] }
      if (model.modality === 'ambient') return { kind: 'assets', assets: [await generateSoundEffect(context, finalPrompt, options.durationSeconds ?? 20, true)] }
      break
  }
  throw new Error(`Sin adaptador para ${model.id}.`)
}

export async function pollGeneration(model: CatalogModel, job: JobRef): Promise<PollResult> {
  if (job.provider === 'fal') {
    const s = await falStatus(job.fal)
    if (s.state !== 'done') return { state: s.state, position: s.position }
    const raw = await falResult(job.fal)
    const outputs = falOutputs(raw, model.modality)
    if (!outputs.length) {
      // Files hosted outside fal's CDN are refused on purpose; say so instead of blaming the safety filter.
      const foreign = [...new Set((JSON.stringify(raw).match(/https:\/\/[^"\\\s]+/g) ?? []).map(u => { try { return new URL(u).hostname } catch { return '' } }).filter(Boolean))]
      if (foreign.length) return { state: 'failed', error: `fal.ai devolvió el archivo en un dominio no permitido (${foreign.slice(0, 3).join(', ')}). Por seguridad no se descarga; si es legítimo, añádelo a FAL_EXTRA_MEDIA_HOSTS. No se ha guardado nada.` }
      return { state: 'failed', error: 'fal.ai terminó sin devolver archivos (posible filtro de seguridad). No se ha guardado nada.' }
    }
    return { state: 'done', media: outputs.map((o, i) => ({ uri: o.url, mimeType: o.contentType, externalId: `${job.fal.requestId}#${i}` })) }
  }
  if (job.provider === 'alibaba') {
    const s = await wanStatus(job.wan)
    if (s.state === 'done') return { state: 'done', media: [{ uri: s.videoUrl, mimeType: 'video/mp4', externalId: `${job.wan.taskId}#0` }] }
    if (s.state === 'failed') return s
    return { state: s.state }
  }
  if (job.provider === 'higgsfield') {
    const s = await higgsfieldStatus(job.hf)
    if (s.status === 'queued' || s.status === 'in_progress') return { state: s.status === 'queued' ? 'queued' : 'running' }
    if (s.status !== 'completed') return { state: 'failed', error: s.status === 'nsfw' ? 'Higgsfield bloqueó el contenido (filtro de seguridad). Los créditos se reembolsan.' : `Higgsfield: ${s.error || s.status}. Los créditos de peticiones fallidas se reembolsan.` }
    const urls = model.modality === 'video' ? (s.video?.url ? [s.video.url] : []) : (s.images ?? []).map(i => i.url)
    if (!urls.length) return { state: 'failed', error: 'Higgsfield terminó sin devolver archivos.' }
    return { state: 'done', media: urls.map((uri, i) => ({ uri, mimeType: model.modality === 'video' ? 'video/mp4' : 'image/png', externalId: `${job.hf.requestId}#${i}` })) }
  }
  const s = await veoStatus(job.veo)
  if (s.state === 'running') return { state: 'running' }
  if (s.state === 'failed') return s
  return { state: 'done', media: [{ uri: await veoDownload(s.videoUri), mimeType: 'video/mp4', externalId: `${job.veo.operation.split('/').pop()}#0` }] }
}
