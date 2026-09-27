import { dispatchJob, loadPersona, ViError } from '@/lib/virtual-influencer/server'
import { withUser } from '@/lib/virtual-influencer/http'
import { adapterById, adapterStatus } from '@/lib/virtual-influencer/providers'
import { OpenAIVoiceProvider } from '@/lib/providers/openai-voice'
import { ElevenLabsVoiceProvider } from '@/lib/providers/elevenlabs'
import { persistGeneratedAsset } from '@/lib/providers/persist'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Runs a queued job. Only reaches a provider when preflight passed at creation (budget, connection,
 * identity). Adapters without an implementation here are NOT_CONNECTED.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  return withUser(async ({ db, userId }) => {
    const { data } = await db.from('vi_generation_jobs').select('persona_id,provider,status').eq('id', jobId).eq('owner_id', userId).maybeSingle()
    const row = data as { persona_id: string; provider: string; status: string } | null
    if (!row) throw new ViError('Trabajo no encontrado.', 404)
    const adapter = adapterById(row.provider)
    if (!adapter || adapterStatus(adapter) !== 'CONNECTED') throw new ViError(`NOT_CONNECTED: ${adapter?.label ?? row.provider}.`, 409)
    const persona = await loadPersona(db, userId, row.persona_id)
    const requestId = crypto.randomUUID()
    return dispatchJob(db, userId, jobId, async job => {
      const voiceId = typeof job.inputs.providerVoiceId === 'string' ? job.inputs.providerVoiceId : undefined
      if (job.provider === 'openai-voice') return new OpenAIVoiceProvider().synthesize({ ownerId: userId, projectId: persona.project_id, requestId }, job.prompt, voiceId)
      if (job.provider === 'elevenlabs-voice') return new ElevenLabsVoiceProvider().synthesize({ ownerId: userId, projectId: persona.project_id, requestId }, job.prompt, voiceId)
      throw new ViError(`NOT_CONNECTED: no hay integración de ejecución para ${adapter.label}.`, 409)
    }, asset => {
      asset.metadata = { ...(asset.metadata ?? {}), purpose: 'virtual_influencer', personaId: persona.id, viJobId: jobId }
      return persistGeneratedAsset({ ownerId: userId, projectId: persona.project_id, requestId }, 'voice', asset) as Promise<{ id: string }>
    })
  })
}
