/**
 * Seed topics: queries to TEST, not findings. They are a curated catalogue of subniches (editorial choice, not data) per niche and language;
 * what each one is worth is decided by the API data returned when it is analysed. Languages without seeds fall back to English.
 */
export type SeedLang = 'es' | 'en' | 'de'
export const SEED_LANGS: SeedLang[] = ['es', 'en', 'de']

export const SEEDS: Record<string, Record<SeedLang, string[]>> = {
  tecnologia: {
    es: ['mejores gadgets baratos', 'tutorial de programación para principiantes', 'ciberseguridad para principiantes', 'reseñas de portátiles', 'domótica en casa', 'trucos de Excel', 'montar un PC', 'alternativas gratis a programas de pago'],
    en: ['best budget gadgets', 'programming tutorial for beginners', 'cybersecurity for beginners', 'laptop reviews', 'smart home setup', 'Excel tips and tricks', 'build a PC', 'free alternatives to paid software'],
    de: ['beste günstige Gadgets', 'Programmieren lernen für Anfänger', 'IT-Sicherheit für Einsteiger', 'Laptop Test', 'Smart Home einrichten', 'Excel Tipps und Tricks', 'PC selber bauen', 'kostenlose Alternativen zu Bezahlsoftware'],
  },
  ia: {
    es: ['herramientas de inteligencia artificial', 'automatizar tareas con ia', 'ia para negocios', 'agentes de ia explicados', 'generar imágenes con ia', 'ia para estudiar', 'prompts de chatgpt', 'ganar dinero con ia'],
    en: ['AI tools for productivity', 'automate tasks with AI', 'AI for small business', 'AI agents explained', 'AI image generation tutorial', 'AI for students', 'ChatGPT prompts that work', 'make money with AI'],
    de: ['KI Tools für den Alltag', 'Aufgaben mit KI automatisieren', 'KI für kleine Unternehmen', 'KI Agenten erklärt', 'KI Bilder erstellen Anleitung', 'KI zum Lernen', 'ChatGPT Prompts die funktionieren', 'Geld verdienen mit KI'],
  },
  finanzas: {
    es: ['cómo invertir desde cero', 'ahorrar dinero cada mes', 'finanzas personales para jóvenes', 'fondos indexados explicados', 'salir de deudas', 'declaración de la renta explicada', 'inversión inmobiliaria para principiantes', 'jubilación y pensiones'],
    en: ['how to start investing', 'save money every month', 'personal finance for beginners', 'index funds explained', 'get out of debt', 'tax tips explained', 'real estate investing for beginners', 'retirement planning'],
    de: ['investieren für Anfänger', 'jeden Monat Geld sparen', 'Finanzen für Einsteiger', 'ETF Sparplan erklärt', 'Schulden loswerden', 'Steuern sparen erklärt', 'Immobilien als Kapitalanlage', 'Altersvorsorge planen'],
  },
  negocios: {
    es: ['ideas de negocio con poco dinero', 'marketing digital para pymes', 'ingresos pasivos reales', 'cómo vender por internet', 'freelance para empezar', 'negocio sin mostrar la cara', 'productividad para emprendedores', 'automatizar un negocio online'],
    en: ['business ideas with low startup cost', 'digital marketing for small business', 'passive income that works', 'how to sell online', 'freelancing for beginners', 'faceless online business', 'productivity for entrepreneurs', 'automate an online business'],
    de: ['Geschäftsideen mit wenig Startkapital', 'Online Marketing für kleine Unternehmen', 'passives Einkommen aufbauen', 'online verkaufen für Anfänger', 'Freiberufler werden', 'Online Business ohne Gesicht', 'Produktivität für Selbstständige', 'Online Business automatisieren'],
  },
  educacion: {
    es: ['ciencia explicada fácil', 'cómo funciona el cuerpo humano', 'curiosidades del universo', 'matemáticas explicadas', 'física para curiosos', 'química cotidiana', 'cómo funciona la tecnología', 'experimentos caseros'],
    en: ['science explained simply', 'how the human body works', 'universe facts', 'math explained', 'physics for curious people', 'everyday chemistry', 'how technology works', 'science experiments at home'],
    de: ['Wissenschaft einfach erklärt', 'wie funktioniert der menschliche Körper', 'Fakten über das Universum', 'Mathe einfach erklärt', 'Physik für Neugierige', 'Chemie im Alltag', 'wie funktioniert Technik', 'Experimente für zuhause'],
  },
  historia: {
    es: ['historia medieval', 'imperios olvidados', 'documental histórico corto', 'historia de las civilizaciones antiguas', 'guerras y batallas explicadas', 'biografías de personajes históricos', 'historia de tu país', 'misterios de la historia'],
    en: ['medieval history', 'forgotten empires', 'short history documentary', 'ancient civilizations history', 'wars and battles explained', 'biographies of historical figures', 'history of lesser known countries', 'historical mysteries'],
    de: ['Mittelalter Geschichte', 'vergessene Reiche', 'Geschichte Doku kurz', 'antike Hochkulturen', 'Kriege und Schlachten erklärt', 'Biografien historischer Persönlichkeiten', 'Geschichte der Schweiz und Österreichs', 'Rätsel der Geschichte'],
  },
  salud: {
    es: ['dormir mejor', 'psicología cotidiana', 'nutrición fácil', 'ansiedad y estrés consejos', 'salud mental para jóvenes', 'hábitos saludables', 'suplementos explicados', 'meditación guiada'],
    en: ['sleep better tips', 'everyday psychology', 'easy nutrition', 'anxiety and stress tips', 'mental health for young adults', 'healthy habits', 'supplements explained', 'guided meditation'],
    de: ['besser schlafen Tipps', 'Alltagspsychologie', 'einfache Ernährung', 'Angst und Stress Tipps', 'mentale Gesundheit', 'gesunde Gewohnheiten', 'Nahrungsergänzung erklärt', 'geführte Meditation'],
  },
  fitness: {
    es: ['rutina de ejercicio en casa', 'yoga para principiantes', 'running para empezar', 'calistenia desde cero', 'estiramientos diarios', 'perder grasa sin gimnasio', 'entrenamiento para mayores', 'movilidad y espalda'],
    en: ['home workout routine', 'yoga for beginners', 'running for beginners', 'calisthenics from scratch', 'daily stretching routine', 'lose fat without a gym', 'workouts for seniors', 'mobility and back pain'],
    de: ['Workout für zuhause', 'Yoga für Anfänger', 'Laufen für Anfänger', 'Calisthenics für Einsteiger', 'tägliches Dehnen', 'abnehmen ohne Fitnessstudio', 'Training für Senioren', 'Mobility und Rückenschmerzen'],
  },
  cocina: {
    es: ['recetas fáciles', 'cocina saludable', 'postres rápidos', 'meal prep semanal', 'recetas baratas', 'cocina internacional en casa', 'panadería casera', 'recetas con airfryer'],
    en: ['easy recipes', 'healthy cooking', 'quick desserts', 'weekly meal prep', 'budget recipes', 'international cooking at home', 'homemade bread', 'air fryer recipes'],
    de: ['einfache Rezepte', 'gesund kochen', 'schnelle Desserts', 'Meal Prep für die Woche', 'günstige Rezepte', 'internationale Küche zuhause', 'Brot selber backen', 'Heißluftfritteuse Rezepte'],
  },
  viajes: {
    es: ['viajar barato', 'destinos poco conocidos', 'vivir en el extranjero', 'nómada digital', 'rutas por carretera', 'viajar solo', 'consejos de aeropuertos', 'guía de ciudades europeas'],
    en: ['budget travel tips', 'hidden travel destinations', 'living abroad', 'digital nomad life', 'road trip routes', 'solo travel tips', 'airport tips', 'European city guides'],
    de: ['günstig reisen', 'unbekannte Reiseziele', 'Auswandern und im Ausland leben', 'digitaler Nomade', 'Roadtrip Routen', 'allein reisen', 'Flughafen Tipps', 'Städtereisen Europa'],
  },
  gaming: {
    es: ['juegos indie recomendados', 'guía de videojuego para principiantes', 'retro gaming', 'juegos de estrategia', 'trucos y secretos de videojuegos', 'historia de los videojuegos', 'juegos para móvil', 'lore explicado'],
    en: ['best indie games', 'beginner game guide', 'retro gaming', 'strategy games', 'video game secrets', 'history of video games', 'mobile games worth playing', 'game lore explained'],
    de: ['beste Indie Spiele', 'Spiele Guide für Anfänger', 'Retro Gaming', 'Strategiespiele', 'Geheimnisse in Videospielen', 'Geschichte der Videospiele', 'Handyspiele Empfehlungen', 'Spielwelt und Lore erklärt'],
  },
  entretenimiento: {
    es: ['sketch de comedia', 'historias graciosas', 'análisis de películas', 'curiosidades de series', 'retos y experimentos', 'resúmenes de películas', 'cultura pop explicada', 'entrevistas divertidas'],
    en: ['comedy sketches', 'funny stories', 'movie analysis', 'TV show trivia', 'challenges and experiments', 'movie recaps', 'pop culture explained', 'funny interviews'],
    de: ['Comedy Sketche', 'lustige Geschichten', 'Filmanalyse', 'Serien Wissen', 'Challenges und Experimente', 'Film Zusammenfassungen', 'Popkultur erklärt', 'lustige Interviews'],
  },
  musica: {
    es: ['música para estudiar', 'sonidos ambientales relajantes', 'lofi para dormir', 'música de concentración', 'piano relajante', 'música para trabajar', 'ruido blanco', 'lluvia y tormenta sonidos'],
    en: ['music to study', 'relaxing ambient sounds', 'lofi for sleep', 'focus music', 'relaxing piano', 'music for work', 'white noise', 'rain and thunder sounds'],
    de: ['Musik zum Lernen', 'entspannende Umgebungsgeräusche', 'Lofi zum Einschlafen', 'Musik zum Konzentrieren', 'entspannendes Klavier', 'Musik zum Arbeiten', 'weißes Rauschen', 'Regen und Gewitter Geräusche'],
  },
  noticias: {
    es: ['análisis de actualidad', 'política internacional explicada', 'economía explicada', 'geopolítica para principiantes', 'noticias de tecnología', 'resumen semanal de noticias', 'conflictos del mundo explicados', 'datos y gráficos de actualidad'],
    en: ['current events analysis', 'international politics explained', 'economics explained', 'geopolitics for beginners', 'tech news', 'weekly news recap', 'world conflicts explained', 'news data and charts'],
    de: ['Aktuelles Analyse', 'internationale Politik erklärt', 'Wirtschaft einfach erklärt', 'Geopolitik für Einsteiger', 'Tech Nachrichten', 'Wochenrückblick Nachrichten', 'Weltkonflikte erklärt', 'Nachrichten mit Daten und Grafiken'],
  },
  hogar: {
    es: ['reformas baratas', 'huerto en casa', 'carpintería para principiantes', 'bricolaje fácil', 'decoración pequeña', 'reparaciones del hogar', 'jardinería para principiantes', 'limpieza y organización'],
    en: ['cheap home renovation', 'backyard vegetable garden', 'woodworking for beginners', 'easy DIY projects', 'small space decor', 'home repairs', 'gardening for beginners', 'cleaning and organizing'],
    de: ['günstig renovieren', 'Gemüsegarten anlegen', 'Holzarbeiten für Anfänger', 'einfache DIY Projekte', 'kleine Wohnung einrichten', 'Reparaturen im Haushalt', 'Gärtnern für Anfänger', 'Aufräumen und Organisieren'],
  },
  motor: {
    es: ['coches eléctricos', 'mecánica básica', 'reseñas de coches', 'mantenimiento del coche', 'comprar coche usado', 'motos para principiantes', 'camperización', 'conducción eficiente'],
    en: ['electric cars', 'basic car mechanics', 'car reviews', 'car maintenance', 'buying a used car', 'motorcycles for beginners', 'van conversion', 'efficient driving'],
    de: ['Elektroautos', 'Auto Mechanik Grundlagen', 'Auto Tests', 'Autowartung', 'Gebrauchtwagen kaufen', 'Motorrad für Anfänger', 'Camper Ausbau', 'sparsam fahren'],
  },
  animales: {
    es: ['adiestramiento de perros', 'cuidado de gatos', 'animales salvajes', 'acuarios para principiantes', 'razas de perros explicadas', 'comportamiento animal', 'mascotas exóticas', 'cuidado de aves'],
    en: ['dog training', 'cat care', 'wild animals', 'aquariums for beginners', 'dog breeds explained', 'animal behavior', 'exotic pets', 'bird care'],
    de: ['Hundetraining', 'Katzenpflege', 'Wildtiere', 'Aquarium für Anfänger', 'Hunderassen erklärt', 'Tierverhalten', 'exotische Haustiere', 'Vogelpflege'],
  },
  belleza: {
    es: ['rutina skincare', 'moda minimalista', 'peinados fáciles', 'maquillaje natural', 'ropa de segunda mano', 'cuidado del cabello', 'perfumes reseñas', 'estilo personal'],
    en: ['skincare routine', 'minimalist fashion', 'easy hairstyles', 'natural makeup', 'thrift fashion', 'hair care', 'perfume reviews', 'personal style'],
    de: ['Hautpflege Routine', 'minimalistische Mode', 'einfache Frisuren', 'natürliches Make-up', 'Second Hand Mode', 'Haarpflege', 'Parfum Tests', 'persönlicher Stil'],
  },
  misterio: {
    es: ['casos sin resolver', 'misterios históricos', 'crímenes reales', 'desapariciones famosas', 'teorías de conspiración analizadas', 'fenómenos paranormales', 'casos judiciales famosos', 'enigmas del mundo'],
    en: ['unsolved cases', 'unexplained events in history', 'true crime stories', 'famous disappearances', 'conspiracy theories analyzed', 'paranormal phenomena', 'famous court cases', 'world enigmas'],
    de: ['ungelöste Fälle', 'historische Rätsel', 'True Crime Geschichten', 'berühmte Vermisstenfälle', 'Verschwörungstheorien analysiert', 'paranormale Phänomene', 'berühmte Gerichtsfälle', 'Rätsel der Welt'],
  },
  desarrollo: {
    es: ['hábitos que cambian la vida', 'estoicismo práctico', 'productividad sin estrés', 'disciplina y motivación', 'organización personal', 'lectura y aprendizaje rápido', 'minimalismo', 'gestión del tiempo'],
    en: ['habits that change your life', 'practical stoicism', 'productivity without stress', 'discipline and motivation', 'personal organization', 'reading and learning faster', 'minimalism', 'time management'],
    de: ['Gewohnheiten die das Leben verändern', 'praktischer Stoizismus', 'Produktivität ohne Stress', 'Disziplin und Motivation', 'Selbstorganisation', 'schneller lesen und lernen', 'Minimalismus', 'Zeitmanagement'],
  },
  idiomas: {
    es: ['inglés para viajar', 'vocabulario cotidiano en inglés', 'alemán desde cero', 'pronunciación en inglés', 'inglés para el trabajo', 'aprender idiomas rápido', 'frases útiles en otro idioma', 'gramática inglesa explicada'],
    en: ['English for travel', 'everyday English vocabulary', 'German from scratch', 'English pronunciation', 'business English', 'learn languages fast', 'useful phrases in another language', 'English grammar explained'],
    de: ['Englisch für die Reise', 'Alltagsvokabular Englisch', 'Deutsch lernen von Anfang an', 'englische Aussprache', 'Business Englisch', 'Sprachen schnell lernen', 'nützliche Redewendungen', 'englische Grammatik erklärt'],
  },
}

const langOf = (l: string | null): SeedLang => (l === 'es' || l === 'de' ? l : 'en')

/** Seeds of the given niches in a language, interleaved round-robin so every niche is represented. `offset` pages through more ideas. */
export function suggestSeeds(nicheIds: string[], language: string | null, count: number, offset = 0): string[] {
  const lang = langOf(language)
  const ids = (nicheIds.length ? nicheIds : Object.keys(SEEDS)).filter(id => SEEDS[id])
  const lists = ids.map(id => SEEDS[id][lang])
  const out: string[] = []
  const max = Math.max(...lists.map(l => l.length), 0)
  for (let i = 0; i < max; i++) for (const l of lists) if (l[i]) out.push(l[i])
  return out.slice(offset, offset + count)
}
export const seedCapacity = (nicheIds: string[]) => (nicheIds.length ? nicheIds : Object.keys(SEEDS)).filter(id => SEEDS[id]).reduce((t, id) => t + SEEDS[id].en.length, 0)
export const seedFallback = (language: string | null) => language !== null && !['es', 'en', 'de'].includes(language)
