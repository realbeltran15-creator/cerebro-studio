import type { ProviderHealth } from './types'
export type ProviderCapability='image'|'video'|'voice'|'render'
export interface ProviderRuntimeConfig{id:string;capability:ProviderCapability;enabled:boolean;health:ProviderHealth}
const env=(name:string)=>process.env[name]?.trim()
const configured=(...names:string[])=>names.every(name=>Boolean(env(name)))
const state=(id:string,capability:ProviderCapability,...vars:string[]):ProviderRuntimeConfig=>{const ready=configured(...vars);return{id,capability,enabled:ready,health:ready?'ready':'unconfigured'}}
export function getProviderRuntimeConfigs():ProviderRuntimeConfig[]{return[
 state('openai-image','image','OPENAI_API_KEY'),
 state('image-fallback','image','IMAGE_FALLBACK_ENDPOINT','IMAGE_FALLBACK_API_KEY'),
 state('openai-voice','voice','OPENAI_VOICE_API_KEY'),
 state('voice-primary','voice','VOICE_PROVIDER_ENDPOINT','VOICE_PROVIDER_API_KEY'),
 state('voice-fallback','voice','VOICE_FALLBACK_ENDPOINT','VOICE_FALLBACK_API_KEY'),
 state('fal-h3-turbo','video','FAL_KEY'),
 state('video-primary','video','VIDEO_PROVIDER_ENDPOINT','VIDEO_PROVIDER_API_KEY'),
 state('video-fallback','video','VIDEO_FALLBACK_ENDPOINT','VIDEO_FALLBACK_API_KEY'),
 state('render-worker','render','RENDER_WORKER_URL','RENDER_WORKER_TOKEN'),
]}
export function publicProviderState(){return getProviderRuntimeConfigs()}
