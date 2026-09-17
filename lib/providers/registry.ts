import type {
  ImageGenerationProvider,
  RenderProvider,
  VideoGenerationProvider,
  VoiceProvider,
} from './types'

type SupportedProvider = ImageGenerationProvider | VoiceProvider | VideoGenerationProvider | RenderProvider

export class ProviderRegistry<T extends SupportedProvider> {
  private readonly providers = new Map<string, T>()

  register(provider: T) {
    if (this.providers.has(provider.id)) {
      throw new Error(`Provider already registered: ${provider.id}`)
    }
    this.providers.set(provider.id, provider)
    return this
  }

  get(id: string) {
    return this.providers.get(id)
  }

  async resolve(primaryId: string, fallbackId?: string) {
    const primary = this.providers.get(primaryId)
    if (primary && (await primary.health()) === 'ready') return primary

    if (fallbackId) {
      const fallback = this.providers.get(fallbackId)
      if (fallback && (await fallback.health()) === 'ready') return fallback
    }

    throw new Error(`No ready provider available for ${primaryId}${fallbackId ? ` or ${fallbackId}` : ''}.`)
  }
}
