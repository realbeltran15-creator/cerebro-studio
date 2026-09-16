const modules = [
  ["Market Intelligence", "Descubre vídeos, canales, nichos y mercados."],
  ["Radar de tendencias", "Detecta señales y oportunidades emergentes."],
  ["Crear vídeo", "Guion, storyboard, escenas, voz, música y render."],
  ["Editor", "Edición multipista y adaptación a distintos formatos."],
  ["Distribución", "YouTube, Shorts, Reels y TikTok con aprobación."],
  ["Analytics", "Mide resultados y alimenta el aprendizaje del sistema."],
];

export default function Home() {
  return (
    <main>
      <aside>
        <div className="brand"><span>◆</span> Cerebro Studio</div>
        <nav>
          <strong>Dashboard</strong>
          <span>Market Intelligence</span><span>Radar de tendencias</span>
          <span>Oportunidades</span><span>Proyectos</span><span>Crear vídeo</span>
          <span>Editor</span><span>Distribución</span><span>Analytics</span>
          <span>Biblioteca</span><span>Conectores</span>
        </nav>
      </aside>
      <section className="content">
        <header><div><small>WORKSPACE</small><h1>Centro de operaciones</h1></div><button>+ Nuevo proyecto</button></header>
        <div className="hero"><div><small>CEREBRO IA</small><h2>De una oportunidad a contenido medible.</h2><p>Investiga el mercado, produce contenido original, distribúyelo con aprobación humana y aprende de resultados reales.</p></div><div className="status"><b>Sistema</b><span>● Base de datos activa</span><span>● Seguridad RLS activa</span><span>● GitHub conectado</span></div></div>
        <h3>Módulos</h3>
        <div className="grid">{modules.map(([title, text]) => <article key={title}><div className="icon">◇</div><h3>{title}</h3><p>{text}</p><span className="open">Abrir →</span></article>)}</div>
      </section>
    </main>
  );
}
