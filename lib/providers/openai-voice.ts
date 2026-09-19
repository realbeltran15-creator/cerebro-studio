import type { GeneratedAsset, ProviderContext, ProviderHealth, VoiceProvider } from './types'
const voices = new Set(['alloy','ash','ballad','coral','echo','fable','nova','onyx','sage','shimmer'])
export class OpenAIVoiceProvider implements VoiceProvider {
 readonly id='openai-voice'
 async health():Promise<ProviderHealth>{return process.env.OPENAI_VOICE_API_KEY||process.env.OPENAI_API_KEY?'ready':'unconfigured'}
 async synthesize(context:ProviderContext,text:string,voice?:string):Promise<GeneratedAsset>{
 const key=process.env.OPENAI_VOICE_API_KEY||process.env.OPENAI_API_KEY
 if(!key)throw new Error('OpenAI voice provider is not configured.')
 const selectedVoice=voice&&voices.has(voice)?voice:'alloy'
 const response=await fetch('https://api.openai.com/v1/audio/speech',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','X-Client-Request-Id':context.requestId},body:JSON.stringify({model:'tts-1',input:text,voice:selectedVoice,response_format:'mp3'}),signal:AbortSignal.timeout(90000)})
 if(!response.ok)throw new Error(`OpenAI voice generation failed (${response.status}).`)
 const bytes=Buffer.from(await response.arrayBuffer())
 if(!bytes.length||bytes.byteLength>25*1024*1024)throw new Error('OpenAI voice returned invalid audio size.')
 return{provider:this.id,mimeType:'audio/mpeg',uri:`data:audio/mpeg;base64,${bytes.toString('base64')}`,metadata:{model:'tts-1',voice:selectedVoice}}
 }
}
