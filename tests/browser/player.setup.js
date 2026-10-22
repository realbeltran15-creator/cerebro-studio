// A 90-minute montage for the player: 45 clips of 2 minutes (red / blue images) with a green video at 44:00–46:00, music and a voice.
;(() => {
  const clip = (i, vis) => ({ id: `c${i}`, sceneId: `c${i}`, position: i + 1, narration: null, visualAssetId: vis, voiceAssetId: null, durationMs: 120000, motion: 'none', transition: 'cut' })
  const clips = Array.from({ length: 45 }, (_, i) => clip(i, i === 22 ? 'vid' : i % 2 ? 'img2' : 'img'))
  const asset = (id, type, title) => ({ id, project_id: 'p1', owner_id: 'u1', asset_type: type, storage_path: `u1/p1/${id}`, license_status: 'owned', source_provider: 'test', provenance: { title }, created_at: '2026-10-20T20:00:00Z' })
  window.__DB.render_jobs = [{ id: 'job1', project_id: 'p1', status: 'draft', updated_at: '2026-10-20T20:00:00.000Z', composition: {
    version: 1, storyboardId: 'sb', title: 'Largo', format: '16:9', clips, editedManually: true, subtitles: false, fadeMs: 0, musicAssetId: null, musicVolume: 0.25, duckMusic: true,
    audioClips: [{ id: 'm1', assetId: 'mus', kind: 'music', linkedClipId: null, offsetMs: 0, startMs: 2_699_000, trimInMs: 0, durationMs: 10000, volume: 0.5, muted: false }],
  } }]
  window.__DB.assets.push(asset('img2', 'image', 'Foto azul'))
  const ready = window.__MEDIA_READY
  window.__MEDIA_READY = (async () => {
    await ready
    const oc = new OffscreenCanvas(1600, 900); const x = oc.getContext('2d'); x.fillStyle = '#2040e0'; x.fillRect(0, 0, 1600, 900)
    window.__URLS.img2 = URL.createObjectURL(await oc.convertToBlob({ type: 'image/png' }))
  })()
})()
