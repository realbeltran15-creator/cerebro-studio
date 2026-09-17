import type {
  ImageGenerationProvider,
  PublicationProvider,
  RenderProvider,
  VideoGenerationProvider,
  VoiceProvider,
} from './types'

type SupportedProvider = ImageGenerationProvider | VoiceProvider | VideoGenerationProvider | RenderProvider | PublicationProvider

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

  list() {
    return [...this.providers.keys()]
  }

  async resolve(primaryId: string, fallbackId?: string) {
    const candidates = [primaryId, fallbackId].filter((id): id is string => Boolean(id))

    for (const id of candidates) {
      const provider = this.providers.get(id)
      if (!provider) continue
      try {
        if ((await provider.health()) === 'ready') return provider
      } catch {
        // A failing health check must not prevent trying the configured fallback.
      }
    }

    throw new Error(`No ready provider available for ${candidates.join(' or ')}.`)
  }
}
