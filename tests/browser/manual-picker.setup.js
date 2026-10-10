// Minimal environment for the manual editor picker. The database survives the page navigation (sessionStorage) so
// "create an empty edit → open it" can be followed across the reload the app performs.
(() => {
  const saved = sessionStorage.getItem('cerebro.db')
  window.__DB = saved ? JSON.parse(saved) : {
    projects: [{ id: 'p1', name: 'Proyecto de prueba', updated_at: '2026-10-10T08:00:00Z' }],
    render_jobs: [{ id: 'job9', project_id: 'p1', status: 'draft', updated_at: '2026-10-09T08:00:00Z', output_format: '16:9', composition: { version: 1, storyboardId: 'sb', title: 'Montaje de prueba', format: '16:9', subtitles: true, fadeMs: 300, musicAssetId: null, musicVolume: 0.25, duckMusic: true, clips: [{ id: 'a', sceneId: 'a', position: 1, narration: null, visualAssetId: null, voiceAssetId: null, durationMs: 4000, motion: 'none' }] } }],
    assets: [],
  }
  window.__UPLOADS = []
  window.addEventListener('pagehide', () => sessionStorage.setItem('cerebro.db', JSON.stringify(window.__DB)))
})()
