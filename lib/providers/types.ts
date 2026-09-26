export type ProviderHealth = 'ready' | 'degraded' | 'unconfigured'

export interface ProviderContext {
  ownerId: string
  projectId: string
  requestId: string
}

export interface GeneratedAsset {
  provider: string
  externalId?: string
  mimeType: string
  uri: string
  metadata?: Record<string, unknown>
}

export type ImageSize = '1024x1024' | '1536x1024' | '1024x1536'

export interface ImageGenerationOptions {
  size?: ImageSize
}

export interface ImageGenerationProvider {
  readonly id: string
  health(): Promise<ProviderHealth>
  generateImage(context: ProviderContext, prompt: string, options?: ImageGenerationOptions): Promise<GeneratedAsset>
}

export interface VoiceProvider {
  readonly id: string
  health(): Promise<ProviderHealth>
  synthesize(context: ProviderContext, text: string, voice?: string): Promise<GeneratedAsset>
}

export interface VideoGenerationProvider {
  readonly id: string
  health(): Promise<ProviderHealth>
  generateVideo(context: ProviderContext, prompt: string): Promise<GeneratedAsset>
}

export interface RenderProvider {
  readonly id: string
  health(): Promise<ProviderHealth>
  render(context: ProviderContext, manifest: Record<string, unknown>): Promise<GeneratedAsset>
}

export interface PublicationProvider {
  readonly id: string
  health(): Promise<ProviderHealth>
  /** Must only be invoked after assertPublicationApproved succeeds. */
  publish(context: ProviderContext, payload: Record<string, unknown>): Promise<{ externalId: string; url?: string }>
}
