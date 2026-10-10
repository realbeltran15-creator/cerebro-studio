import type { GeneratedAsset, ImageGenerationOptions, ImageGenerationProvider, ProviderContext, ProviderHealth } from './types'
import type { ReferenceImage } from './references'

/** Model is configurable so a newer OpenAI image model can be selected without code changes. */
export const imageModel = () => process.env.OPENAI_IMAGE_MODEL?.trim() || 'gpt-image-1'

export type OpenAIImageCallOptions = ImageGenerationOptions & { model?: string; references?: ReferenceImage[] }

export class OpenAIImageProvider implements ImageGenerationProvider {
  readonly id = 'openai-image'

  async health(): Promise<ProviderHealth> {
    return process.env.OPENAI_API_KEY ? 'ready' : 'unconfigured'
  }

  async generateImage(context: ProviderContext, prompt: string, options?: OpenAIImageCallOptions): Promise<GeneratedAsset> {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('OpenAI image provider is not configured.')

    const model = options?.model && /^gpt-image-[a-z0-9.-]+$/.test(options.model) ? options.model : imageModel()
    const refs = (options?.references ?? []).slice(0, 10)
    const size = options?.size ?? '1024x1024'
    let response: Response
    if (refs.length) {
      // With references the image is built through /images/edits (multiple input images); gpt-image-1 keeps faces better with high fidelity.
      const form = new FormData()
      form.append('model', model)
      form.append('prompt', prompt)
      form.append('size', size)
      if (options?.quality) form.append('quality', options.quality)
      if (model === 'gpt-image-1') form.append('input_fidelity', 'high')
      refs.forEach((r, i) => form.append('image[]', new Blob([new Uint8Array(r.bytes)], { type: r.mime }), `reference-${i}.${r.mime === 'image/png' ? 'png' : r.mime === 'image/webp' ? 'webp' : 'jpg'}`))
      response = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'X-Client-Request-Id': context.requestId }, body: form, cache: 'no-store', signal: AbortSignal.timeout(180000) })
    } else {
      response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Client-Request-Id': context.requestId },
        body: JSON.stringify({ model, prompt, size, ...(options?.quality ? { quality: options.quality } : {}) }),
        cache: 'no-store', signal: AbortSignal.timeout(180000),
      })
    }

    if (!response.ok) {
      throw new Error(`OpenAI image generation failed (${response.status}).`)
    }

    const payload = await response.json() as { data?: Array<{ url?: string; b64_json?: string }>; usage?: Record<string, unknown> }
    const item = payload.data?.[0]
    if (!item) throw new Error('OpenAI image generation returned no asset.')

    const uri = item.url ?? (item.b64_json ? `data:image/png;base64,${item.b64_json}` : undefined)
    if (!uri) throw new Error('OpenAI image generation returned no usable URI.')

    return {
      provider: this.id,
      mimeType: 'image/png',
      uri,
      metadata: { model, size, quality: options?.quality ?? 'auto', references: refs.map(x => x.assetId), usage: payload.usage ?? null },
    }
  }
}
