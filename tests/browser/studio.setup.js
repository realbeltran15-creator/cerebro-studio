// Seeded database and a synthetic image for the Creation Studio test.
window.__IMG_READY = (async () => {
  const oc = new OffscreenCanvas(1536, 864); const x = oc.getContext('2d')
  const g = x.createLinearGradient(0, 0, 1536, 864); g.addColorStop(0, '#1d5c3a'); g.addColorStop(1, '#0b2618'); x.fillStyle = g; x.fillRect(0, 0, 1536, 864)
  window.__IMG = URL.createObjectURL(await oc.convertToBlob({ type: 'image/png' }))
})()
window.__DB = {
  projects: [{ id: 'p1', owner_id: 'u1', name: 'Juliane Koepcke', description: 'Superviviente de la selva, 1971', status: 'production', target_platforms: ['youtube'], created_at: '2026-09-20T00:00:00Z', updated_at: '2026-09-29T00:00:00Z' }],
  storyboards: [{ id: 'b1', project_id: 'p1', owner_id: 'u1', title: 'Guion v2', created_at: '2026-09-25T00:00:00Z' }],
  scenes: [
    { id: 's1', storyboard_id: 'b1', owner_id: 'u1', position: 1, narration: 'Nochebuena de 1971.', visual_prompt: 'Cabina de un avión de hélice, 1971', video_prompt: null, ambient_prompt: 'Motor', metadata: { heading: 'Hook' } },
    { id: 's2', storyboard_id: 'b1', owner_id: 'u1', position: 2, narration: 'Despertó sola en la selva.', visual_prompt: 'Una joven sola en la selva peruana tras la lluvia, 1971', video_prompt: 'Travelling lento entre la vegetación', ambient_prompt: 'Lluvia', metadata: { heading: 'Punto de no retorno', music: 'ambient grave, 60 BPM' } },
  ],
  assets: [],
}
