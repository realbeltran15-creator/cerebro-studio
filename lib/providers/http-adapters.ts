import type { GeneratedAsset, ProviderContext, ProviderHealth, RenderProvider, VideoGenerationProvider, VoiceProvider } from './types'

type JsonAssetResponse = { id?: string; url?: string; uri?: string; mimeType?: string; metadata?: Record<string, unknown> }

async function callJsonAsset(endpoint: string, token: string, body: Record<string, unknown>, context: ProviderContext): Promise<JsonAssetResponse> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': context.requestId,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`Provider request failed (${response.status}).`)
  return response.json() as Promise<JsonAssetResponse>
}

export class HttpVideoProvider implements VideoGenerationProvider {
  readonly id = 'video-primary'
  async health(): Promise<ProviderHealth> { return process.env.VIDEO_PROVIDER_API_KEY && process.env.VIDEO_PROVIDER_ENDPOINT ? 'ready' : 'unconfigured' }
  async generateVideo(context: ProviderContext, prompt: string): Promise<GeneratedAsset> {
    const endpoint=process.env.VIDEO_PROVIDER_ENDPOINT, token=process.env.VIDEO_PROVIDER_API_KEY
    if(!endpoint||!token) throw new Error('Video provider is not configured.')
    const r=await callJsonAsset(endpoint,token,{prompt,projectId:context.projectId},context)
    const uri=r.url??r.uri; if(!uri) throw new Error('Video provider returned no URI.')
    return {provider:this.id,externalId:r.id,mimeType:r.mimeType??'video/mp4',uri,metadata:r.metadata}
  }
}

export class HttpVoiceProvider implements VoiceProvider {
  readonly id = 'voice-primary'
  async health(): Promise<ProviderHealth> { return process.env.VOICE_PROVIDER_API_KEY && process.env.VOICE_PROVIDER_ENDPOINT ? 'ready' : 'unconfigured' }
  async synthesize(context: ProviderContext, text: string, voice?: string): Promise<GeneratedAsset> {
    const endpoint=process.env.VOICE_PROVIDER_ENDPOINT, token=process.env.VOICE_PROVIDER_API_KEY
    if(!endpoint||!token) throw new Error('Voice provider is not configured.')
    const r=await callJsonAsset(endpoint,token,{text,voice,projectId:context.projectId},context)
    const uri=r.url??r.uri; if(!uri) throw new Error('Voice provider returned no URI.')
    return {provider:this.id,externalId:r.id,mimeType:r.mimeType??'audio/mpeg',uri,metadata:r.metadata}
  }
}

export class HttpRenderProvider implements RenderProvider {
  readonly id = 'render-worker'
  async health(): Promise<ProviderHealth> { return process.env.RENDER_WORKER_URL && process.env.RENDER_WORKER_TOKEN ? 'ready' : 'unconfigured' }
  async render(context: ProviderContext, manifest: Record<string, unknown>): Promise<GeneratedAsset> {
    const endpoint=process.env.RENDER_WORKER_URL, token=process.env.RENDER_WORKER_TOKEN
    if(!endpoint||!token) throw new Error('Render worker is not configured.')
    const r=await callJsonAsset(endpoint,token,{manifest,projectId:context.projectId},context)
    const uri=r.url??r.uri; if(!uri) throw new Error('Render worker returned no URI.')
    return {provider:this.id,externalId:r.id,mimeType:r.mimeType??'video/mp4',uri,metadata:r.metadata}
  }
}
