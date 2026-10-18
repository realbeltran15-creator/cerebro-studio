import { composeThumbnail } from '@/lib/thumbnails/compose'
;(window as any).runCompose = async () => {
  const oc = new OffscreenCanvas(1024, 1024); const g = oc.getContext('2d')!; g.fillStyle = '#336'; g.fillRect(0, 0, 1024, 1024)
  const out = await composeThumbnail(await oc.convertToBlob({ type: 'image/png' }), 'Nadie sobrevivió', { position: 'bottom', color: '#ffffff', outline: '#000000', uppercase: true })
  const bmp = await createImageBitmap(out)
  const c = new OffscreenCanvas(bmp.width, bmp.height); const x = c.getContext('2d')!; x.drawImage(bmp, 0, 0)
  // White text pixels exist in the lower part, none in the top part (solid background there).
  const lower = x.getImageData(0, 520, 1280, 150).data, upper = x.getImageData(0, 0, 1280, 150).data
  const white = (d: Uint8ClampedArray) => { let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 230 && d[i + 1] > 230 && d[i + 2] > 230) n++; return n }
  let threw = false; try { await composeThumbnail(await oc.convertToBlob(), 'una frase demasiado larga para una miniatura que nadie podría leer en el móvil jamás') } catch { threw = true }
  return { w: bmp.width, h: bmp.height, type: out.type, lowerWhite: white(lower), upperWhite: white(upper), threw }
}
