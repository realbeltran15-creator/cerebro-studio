import type { ProviderHealth } from './types'

export type ProviderCapability = 'image' | 'video' | 'voice' | 'render'

export interface ProviderRuntimeConfig {
  id: string
  capability: ProviderCapability
  enabled: boolean
  health: ProviderHealth
  endpoint?: string
}

const env = (name: string) => process.env[name]?.trim()

export function getProviderRuntimeConfigs(): ProviderRuntimeConfig[] {
  return [
    {
      id: 'openai-image',
      capability: 'image',
      enabled: Boolean(env('OPENAI_API_KEY')),
      health: env('OPENAI_API_KEY') ? 'ready' : 'unconfigured',
    },
    {
      id: 'elevenlabs',
      capability: 'voice',
      enabled: Boolean(env('ELEVENLABS_API_KEY')),
      health: env('ELEVENLABS_API_KEY') ? 'ready' : 'unconfigured',
    },
    {
      id: 'video-primary',
      capability: 'video',
      enabled: Boolean(env('VIDEO_PROVIDER_API_KEY') && env('VIDEO_PROVIDER_ENDPOINT')),
      health: env('VIDEO_PROVIDER_API_KEY') && env('VIDEO_PROVIDER_ENDPOINT') ? 'ready' : 'unconfigured',
      endpoint: env('VIDEO_PROVIDER_ENDPOINT'),
    },
    {
      id: 'render-worker',
      capability: 'render',
      enabled: Boolean(env('RENDER_WORKER_URL') && env('RENDER_WORKER_TOKEN')),
      health: env('RENDER_WORKER_URL') && env('RENDER_WORKER_TOKEN') ? 'ready' : 'unconfigured',
      endpoint: env('RENDER_WORKER_URL'),
    },
  ]
}

export function publicProviderState() {
  return getProviderRuntimeConfigs().map(({ id, capability, enabled, health }) => ({
    id,
    capability,
    enabled,
    health,
  }))
}
