// Shared MOCK data for the Investigación browser tests and the exploration script. Nothing here calls YouTube or spends quota.
export const mk = (id, title, o) => ({ videoId: id, url: `https://www.youtube.com/watch?v=${id}`, title, channelId: `c${id}`, channelTitle: `Canal ${id}`, publishedAt: new Date(Date.now() - (o.days ?? 3) * 86400000).toISOString(), thumbnailUrl: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, declaredLanguage: o.lang ?? 'en', categoryId: o.cat ?? null, tags: [], live: null,
  observed: { views: o.views, likes: 10, comments: 1, durationSeconds: o.dur, channelSubscribers: o.subs, fetchedAt: new Date().toISOString() }, calculated: { viewsPerDay: Math.round(o.views / (o.days ?? 3)), viewsToSubscribers: Math.round((o.views / o.subs) * 100) / 100, engagementRate: 1 } })

const shared = mk('shared1', 'Inteligencia artificial para programación explicada', { views: 900000, subs: 400000, dur: 600, lang: 'en' })
export const charts = {
  ES: [mk('es1', 'Corto viral de gatos', { views: 90000, subs: 800, dur: 40, lang: 'es' })],
  US: [shared, mk('us1', 'Receta de pasta fácil', { views: 500000, subs: 90000, dur: 500 }), mk('us2', 'Best AI tools for business 2026 tutorial', { views: 700000, subs: 120000, dur: 1500 })],
  DE: [shared, mk('de1', 'Aktien kaufen für Anfänger Tutorial', { views: 300000, subs: 50000, dur: 800, lang: 'de' }), mk('de2', 'KI Tools Test: die besten Programme', { views: 210000, subs: 9000, dur: 1300, lang: 'de' })],
  AU: [mk('au1', 'Best gadgets and tech review 2026', { views: 250000, subs: 70000, dur: 700 })],
}

const slug = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)
export const ana = (topic, region, language, verdict, i, extra = {}) => ({ topic, region, language, fetchedAt: new Date().toISOString(), units: 204, indices: { demand: i.d, supply: i.s, competition: i.c, growth: i.g, opportunity: i.o }, growthPct: 12, verdict,
  headline: verdict === 'oportunidad' ? 'Demanda clara con oferta y competencia manejables' : verdict === 'sin_demanda' ? 'Poca oferta, pero también poca demanda observable: no es una oportunidad' : 'Hay demanda, pero la oferta o los canales dominantes lo hacen difícil',
  reasons: [`Demanda ${i.d}/100: los vídeos más vistos ganan 4 mil vistas/día (mediana).`, `Oferta ${i.s}/100: 3 vídeos nuevos por semana.`, `Competencia ${i.c}/100: canal mediano con 9 mil suscriptores.`], confidence: 'media', confidenceNote: 'Muestra de 25 vídeos más vistos y 25 recientes (YouTube no permite contar todos los vídeos ni creadores).',
  evidence: [{ label: 'Vistas por día (mediana)', value: '4 mil', kind: 'calculado' }, { label: 'Canales distintos entre los vídeos recientes', value: '4 de 25', kind: 'observado' }],
  byFormat: { short: { count: 1, recentCount: 0, medianViewsPerDay: 100 }, long: { count: 20, recentCount: 5, medianViewsPerDay: 900 } }, niches: /\b(AI|KI|IA)\b|inteligencia/i.test(topic) ? ['ia', 'tecnologia'] : ['historia'],
  terms: [{ term: 'historia medieval', videos: 6, views: 90000, share: 0.3 }], emerging: [{ term: 'castillos olvidados', videos: 3, views: 5000, share: 0.2 }], questions: [{ text: '¿Por qué cayó el imperio?', videoId: 'q1', views: 1000 }],
  sampleSizes: { top: 25, recent: 25 }, approxTotals: { top: 120000, recent: 4000 },
  topVideos: [mk(`${slug(topic)}-${region ?? 'w'}-1`, `${topic}: guía completa`, { views: 300000, subs: 4000, dur: 900, days: 40, lang: language ?? 'es' }), mk(`${slug(topic)}-${region ?? 'w'}-2`, `${topic} en 60 segundos #shorts`, { views: 80000, subs: 1500, dur: 40, days: 12, lang: language ?? 'es' }), mk(`${slug(topic)}-${region ?? 'w'}-3`, `Todo sobre ${topic}`, { views: 150000, subs: 900000, dur: 1500, days: 200, lang: language ?? 'es' })], ...extra })

const TOPICS = {
  'historia medieval': { v: 'oportunidad', i: { d: 72, s: 25, c: 30, g: 61, o: 74 } },
  'música de moda': { v: 'saturado', i: { d: 90, s: 90, c: 88, g: 45, o: 22 } },
  'tema sin público': { v: 'sin_demanda', i: { d: 8, s: 5, c: 5, g: 30, o: 12 } },
  'herramientas de inteligencia artificial': { v: 'mixto', i: { d: 80, s: 70, c: 66, g: 70, o: 48 }, niches: ['ia', 'tecnologia'], byRegion: { DE: { v: 'oportunidad', i: { d: 68, s: 30, c: 35, g: 66, o: 71 } }, US: { v: 'saturado', i: { d: 92, s: 88, c: 85, g: 55, o: 20 } } } },
  'automatizar con ia': { v: 'oportunidad', i: { d: 64, s: 28, c: 34, g: 74, o: 69 }, niches: ['ia', 'negocios'] },
}

/** Installs mocked /api/research/* routes. `state.mode`: 'ok' | 'budget' | 'down'. `state.requests` collects every call. */
export async function installResearchRoutes(page, state = { mode: 'ok', requests: [] }) {
  state.requests ??= []; state.mode ??= 'ok'; state.used ??= 0
  await page.route('**/api/research/**', route => {
    const url = new URL(route.request().url()); state.requests.push(url.pathname + url.search)
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (state.mode === 'down') return json({ error: 'YouTube Data API no está configurada. Añade YOUTUBE_API_KEY en las variables del servidor.', configured: false }, 503)
    if (url.pathname.endsWith('/usage')) return json({ usedToday: state.used, cap: 6000, remaining: Math.max(6000 - state.used, 0), persistent: true })
    if (url.pathname.endsWith('/trending')) return json({ configured: true, results: charts[url.searchParams.get('region')] ?? [] })
    if (url.pathname.endsWith('/topic')) {
      if (state.mode === 'budget') return json({ error: 'Presupuesto diario de Investigación agotado: 6000 de 6000 unidades usadas hoy.', budget: { used: 6000, cap: 6000 }, configured: true }, 429)
      const q = url.searchParams.get('q'), region = url.searchParams.get('region'), lang = url.searchParams.get('lang')
      const base = TOPICS[q] ?? { v: 'mixto', i: { d: 50, s: 50, c: 50, g: 50, o: 50 } }
      const t = base.byRegion?.[region] ?? base
      const extra = { recentDays: Number(url.searchParams.get('days')) || 30, ...(region === 'AU' ? { sampleSizes: { top: 9, recent: 3 }, confidence: 'baja' } : {}), ...(base.niches ? { niches: base.niches } : {}) }
      state.used += 204
      return json({ configured: true, analysis: ana(q, region, lang, t.v, t.i, extra), cached: false, usage: { usedToday: state.used, cap: 6000, persistent: true } })
    }
    return json({ configured: true, results: [] })
  })
  return state
}
