#!/usr/bin/env bash
# Genera materiales de DEMOSTRACIÓN (sintéticos, sin derechos de terceros) para probar Cerebro Studio: 2 vídeos cortos con sonido, 1 imagen y 1 tono de música.
# Uso: bash scripts/make-demo-media.sh [carpeta]   (por defecto ./demo-media). Requiere ffmpeg. No sube nada a ningún sitio.
set -euo pipefail
OUT="${1:-demo-media}"; mkdir -p "$OUT"
command -v ffmpeg >/dev/null || { echo "Falta ffmpeg"; exit 1; }
ffmpeg -v error -y -f lavfi -i "testsrc2=s=1280x720:r=30:d=8" -f lavfi -i "sine=f=330:d=8" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$OUT/demo-clip-a-horizontal.mp4"
ffmpeg -v error -y -f lavfi -i "color=c=0x2a6fdb:s=1280x720:r=30:d=6,drawbox=x=100:y=100:w=300:h=300:color=white@0.6:t=fill" -f lavfi -i "sine=f=520:d=6" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$OUT/demo-clip-b-horizontal.mp4"
ffmpeg -v error -y -f lavfi -i "gradients=s=1280x720:d=1:c0=0xc0392b:c1=0xf1c40f:speed=0" -frames:v 1 "$OUT/demo-imagen.png" 2>/dev/null || ffmpeg -v error -y -f lavfi -i "color=c=0xc0392b:s=1280x720:d=1" -frames:v 1 "$OUT/demo-imagen.png"
ffmpeg -v error -y -f lavfi -i "sine=f=220:d=20" -c:a pcm_s16le "$OUT/demo-musica-tono.wav"
ls -la "$OUT"
echo "Listo. Estos archivos son sintéticos y de uso libre; súbelos desde Biblioteca o Añadir materiales."
