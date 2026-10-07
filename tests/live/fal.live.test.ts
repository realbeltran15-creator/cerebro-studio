/**
 * Live fal.ai checks through Cerebro Studio's own code. Two separate opt-ins so nothing spends money by accident:
 *
 *  1) LIVE_FAL=1                          -> connection/credential probe. Sends an INVALID body (no prompt) to the
 *                                            cheapest video model: fal answers 422 at submission, no job is queued
 *                                            and nothing is expected to be billed. Verifies host, auth and error mapping.
 *  2) LIVE_FAL=1 FAL_ALLOW_SPEND=yes      -> ONE real draft generation (about USD 0.025 per fal's public page; confirm it in
 *                                            the fal dashboard). Only after the owner authorised the cost.
 *
 * Run: LIVE_FAL=1 NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=<ca-bundle> npx vitest run tests/live/fal
 * In the sandbox the key is a Network Secret (host queue.fal.run, header Authorization, value prefix "Key "):
 * the process only needs a non-secret placeholder in FAL_KEY so the app's "configured" check passes.
 */
import { describe, expect, it } from 'vitest'
import { modelById } from '@/lib/providers/catalog'
import { pollGeneration, startGeneration } from '@/lib/providers/adapters'
import { falSubmit } from '@/lib/providers/fal-queue'

const live = process.env.LIVE_FAL === '1'
const spend = live && process.env.FAL_ALLOW_SPEND === 'yes'
if (live && !process.env.FAL_KEY?.trim()) process.env.FAL_KEY = 'proxy-injected-placeholder'
const model = modelById('fal:fal-ai/wan/v2.2-5b/text-to-video/fast-wan')!

describe.skipIf(!live)('fal.ai connection probe (invalid body, no job, no spend expected)', () => {
  it('reaches queue.fal.run with valid credentials and gets a validation error for an empty body', async () => {
    const err = await falSubmit('fal-ai/wan/v2.2-5b/text-to-video/fast-wan', {}).then(() => null, e => e as Error)
    expect(err, 'fal accepted an empty body: a job may have been queued, check the dashboard').not.toBeNull()
    expect(err!.message).toMatch(/\(422\)/) // 401/403 would mean a bad key or no balance; anything else, a host/policy problem
    expect(err!.message).not.toMatch(/AIza|Key /)
  }, 60000)
})

describe.skipIf(!spend)('fal.ai ONE real draft generation (spends about USD 0.025; owner-authorised)', () => {
  it('queues, polls, returns a real MP4 on a fal media host', async () => {
    const started = await startGeneration({ model, prompt: 'A calm shot of rain falling on green jungle leaves, soft light', finalPrompt: 'A calm shot of rain falling on green jungle leaves, soft light', options: {}, context: { ownerId: 'live', projectId: 'live', requestId: 'live-fal' } } as never)
    expect(started.kind).toBe('job')
    if (started.kind !== 'job' || started.job.provider !== 'fal') throw new Error('expected a fal job')
    let result = await pollGeneration(model, started.job)
    for (let i = 0; i < 90 && result.state !== 'done' && result.state !== 'failed'; i++) { await new Promise(r => setTimeout(r, 4000)); result = await pollGeneration(model, started.job) }
    expect(result.state).toBe('done')
    if (result.state !== 'done') return
    const media = result.media[0]
    expect(new URL(media.uri).hostname).toMatch(/(^|\.)fal\.media$/)
    const res = await fetch(media.uri, { redirect: 'error' })
    const head = Buffer.from(await res.arrayBuffer()).subarray(0, 12).toString('latin1')
    expect(head.slice(4, 8)).toBe('ftyp') // a real MP4 container
  }, 600000)
})
