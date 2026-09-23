import type { GeneratedAsset, ImageGenerationProvider, ProviderContext, ProviderHealth } from './types'

export class OpenAIImageProvider implements ImageGenerationProvider {
  readonly id = 'openai-image'

  async health(): Promise<ProviderHealth> {
    return process.env.OPENAI_API_KEY ? 'ready' : 'unconfigured'
  }

  async generateImage(context: ProviderContext, prompt: string): Promise<GeneratedAsset> {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('OpenAI image provider is not configured.')

    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Client-Request-Id': context.requestId,
      },
      body: JSON.stringify({ model: 'gpt-image-1', prompt, size: '1024x1024' }),
    })

    if (!response.ok) {
      throw new Error(`OpenAI image generation failed (${response.status}).`)
    }

    const payload = await response.json() as { data?: Array<{ url?: string; b64_json?: string }> }
    const item = payload.data?.[0]
    if (!item) throw new Error('OpenAI image generation returned no asset.')

    const uri = item.url ?? (item.b64_json ? `data:image/png;base64,${item.b64_json}` : undefined)
    if (!uri) throw new Error('OpenAI image generation returned no usable URI.')

    return {
      provider: this.id,
      mimeType: 'image/png',
      uri,
      metadata: { requestId: context.requestId, projectId: context.projectId },
    }
  }
}
