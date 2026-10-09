import type { GeneratedAsset, ProviderContext, ProviderHealth, VideoGenerationProvider } from './types'

/** Fixed-cost smoke-test adapter. Never retries a submitted generation. */
export class FalH3TurboVideoProvider implements VideoGenerationProvider {
 readonly id = 'fal-h3-turbo'
 async health(): Promise<ProviderHealth> {
  return process.env.FAL_KEY?.trim() ? 'ready' : 'unconfigured'
 }
 async generateVideo(_context: ProviderContext, prompt: string): Promise<GeneratedAsset> {
  const key = process.env.FAL_KEY?.trim()
  if (!key) throw new Error('fal.ai is not configured.')
  const response = await fetch('https://fal.run/minimax/h3-max-turbo/text-to-video', {
   method: 'POST',
   headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
   body: JSON.stringify({
    prompt, duration: 5, resolution: '480P', aspect_ratio: '16:9',
    prompt_expansion_mode: 'disabled', enable_safety_checker: true
   }),
   cache: 'no-store',
   signal: AbortSignal.timeout(90000)
  })
  if (!response.ok) throw new Error(`fal.ai generation returned HTTP ${response.status}; check the provider dashboard before retrying to avoid duplicate charges.`)
  const data = await response.json() as {video?: {url?:string;content_type?:string}}
  if (!data.video?.url) throw new Error('fal.ai did not return a video URL; check provider dashboard before retrying.')
  return { provider: this.id, uri: data.video.url, mimeType: data.video.content_type ?? 'video/mp4',
   metadata: {model:'minimax/h3-max-turbo/text-to-video',durationSeconds:5,resolution:'480P'} }
 }
}
