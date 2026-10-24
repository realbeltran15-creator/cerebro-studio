import { uploadToCloud } from '@/lib/storage/client'
declare global { interface Window { runUpload: (size: number) => Promise<{ path: string; progress: number[] }>; startUpload: (size: number) => void } }
const file = (size: number) => new File([new Uint8Array(size)], 'concierto.mp4', { type: 'video/mp4', lastModified: 1_700_000_000_000 })
window.runUpload = async size => {
  const progress: number[] = []
  const path = await uploadToCloud(null as never, { projectId: 'library', folder: 'uploads', ext: 'mp4', name: 'abcdefgh-1', body: file(size), contentType: 'video/mp4', onProgress: f => progress.push(Math.round(f * 100) / 100) })
  return { path, progress }
}
window.startUpload = size => { void window.runUpload(size).catch(() => undefined) }
