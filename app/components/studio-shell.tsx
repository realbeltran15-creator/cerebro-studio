import Link from 'next/link'

export const studioModules = [
  ['Dashboard','/'],['Market Intelligence','/market-intelligence'],['Radar','/radar'],['Oportunidades','/opportunities'],['Proyectos','/projects'],['Crear vídeo','/create'],['Guiones','/scripts'],['Imágenes','/images'],['Vídeos','/videos'],['Voces','/voices'],['Música / SFX','/audio'],['Editor','/editor'],['Shorts / Reels / TikTok','/repurpose'],['Miniaturas','/thumbnails'],['YouTube','/youtube'],['Analytics','/analytics'],['Biblioteca','/library'],['Automatizaciones','/automations'],['Conectores','/connectors']
] as const

export function StudioShell({title,children}:{title:string;children:React.ReactNode}) {
 return <main><aside><Link href="/" className="brand"><span>◆</span> Cerebro Studio</Link><nav>{studioModules.map(([label,href])=><Link href={href} key={href}>{label}</Link>)}</nav></aside><section className="content"><header><div><small>WORKSPACE</small><h1>{title}</h1></div><Link className="buttonLink" href="/projects">Proyectos</Link></header>{children}</section></main>
}

export function ModulePage({title,description,steps}:{title:string;description:string;steps:string[]}) {
 return <StudioShell title={title}><div className="hero"><div><small>MÓDULO</small><h2>{title}</h2><p>{description}</p></div><div className="status"><b>Estado</b><span>● Interfaz preparada</span><span>○ Integración funcional: fase siguiente</span><span>○ Publicación real bloqueada</span></div></div><h3>Flujo</h3><div className="grid">{steps.map((step,i)=><article key={step}><div className="icon">{i+1}</div><h3>{step}</h3><p>Área preparada para datos, proveedores y automatizaciones.</p></article>)}</div></StudioShell>
}
