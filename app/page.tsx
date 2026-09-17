import Link from 'next/link'

const modules = [
  ["Market Intelligence", "Descubre vídeos, canales, nichos y mercados.", "/market-intelligence"],
  ["Radar de tendencias", "Detecta señales y oportunidades emergentes.", "/radar"],
  ["Crear vídeo", "Guion, storyboard, escenas, voz, música y render.", "/create"],
  ["Editor", "Edición multipista y adaptación a distintos formatos.", "/editor"],
  ["Distribución", "YouTube, Shorts, Reels y TikTok con aprobación.", "/youtube"],
  ["Analytics", "Mide resultados y alimenta el aprendizaje del sistema.", "/analytics"],
] as const;

const navigation = [
  ["Dashboard", "/"],
  ["Market Intelligence", "/market-intelligence"],
  ["Radar de tendencias", "/radar"],
  ["Oportunidades", "/opportunities"],
  ["Proyectos", "/projects"],
  ["Crear vídeo", "/create"],
  ["Editor", "/editor"],
  ["Distribución", "/youtube"],
  ["Analytics", "/analytics"],
  ["Biblioteca", "/library"],
  ["Conectores", "/connectors"],
] as const;

export default function Home() {
  return (
    <main>
      <aside>
        <Link href="/" className="brand"><span>◆</span> Cerebro Studio</Link>
        <nav>
          {navigation.map(([label, href]) => <Link href={href} key={href}>{label}</Link>)}
        </nav>
      </aside>
      <section className="content">
        <header><div><small>WORKSPACE</small><h1>Centro de operaciones</h1></div><Link className="buttonLink" href="/projects">+ Nuevo proyecto</Link></header>
        <div className="hero"><div><small>CEREBRO IA</small><h2>De una oportunidad a contenido medible.</h2><p>Investiga el mercado, produce contenido original, distribúyelo con aprobación humana y aprende de resultados reales.</p></div><div className="status"><b>Sistema</b><span>● Base de datos configurada</span><span>● Seguridad RLS activa</span><span>● GitHub conectado</span></div></div>
        <h3>Módulos</h3>
        <div className="grid">{modules.map(([title, text, href]) => <article key={title}><div className="icon">◇</div><h3>{title}</h3><p>{text}</p><Link className="open" href={href}>Abrir →</Link></article>)}</div>
      </section>
    </main>
  );
}
