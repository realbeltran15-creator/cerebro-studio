'use client'

import { useState } from 'react'

/** The official thumbnail of a YouTube video. If the given address is missing or fails to load, YouTube's standard thumbnail address for that video id is tried once; then a plain placeholder. */
export const youtubeThumb = (videoId: string) => `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`

export function Thumb({ videoId, src, width = 320, height = 180, className, style }: { videoId: string; src?: string | null; width?: number; height?: number; className?: string; style?: React.CSSProperties }) {
  const [stage, setStage] = useState<0 | 1 | 2>(src ? 0 : 1)
  if (stage === 2 || !videoId) return <span className="thumbMissing" role="img" aria-label="Miniatura no disponible">Sin miniatura</span>
  /* eslint-disable-next-line @next/next/no-img-element */
  return <img className={className} style={style} src={stage === 0 ? (src as string) : youtubeThumb(videoId)} alt="" loading="lazy" width={width} height={height} onError={() => setStage(s => (s === 0 ? 1 : 2))} />
}
