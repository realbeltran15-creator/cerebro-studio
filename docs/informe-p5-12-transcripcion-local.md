# Informe P5.12 — Transcripción automática local

Rama `beta-privada`, coste 0 €, sin push ni cambios remotos.

## 1. Motores evaluados (fuentes oficiales; NO medidos aquí salvo lo indicado)
- **whisper.cpp** (licencia MIT; modelos de ggerganov/whisper.cpp con licencia MIT). Funciona solo en CPU, offline, con binarios/compilación para Windows.
- Tamaños en disco publicados: tiny 75 MiB (q5_1 31 MiB), base 142 MiB (q5_1 57 MiB), small 466 MiB (q5_1 181 MiB), medium 1,5 GiB (q5_0 514 MiB), large-v3-turbo q5_0 547 MiB. Los modelos sin sufijo `.en` son multilingües (español, inglés, alemán incluidos).
- La página oficial NO indica RAM por modelo, así que no se afirma ninguna cifra de RAM/CPU/precisión: queda por medir.
- Alternativas ligeras (Vosk, etc.) no se evaluaron en profundidad; sin pruebas, sin conclusiones.

## 2. Pruebas realmente ejecutadas
- Compilación de `whisper-cli` desde el código fuente oficial en el entorno de pruebas (2 CPU, 8 GB): correcta.
- Descarga de modelos (tiny-q5_1, base-q5_1) **BLOQUEADA** por la red del entorno (HTTP 403 a huggingface.co). No se rodeó el bloqueo. **Por tanto no hay medición de memoria, tiempo ni calidad de transcripción real.**
- Audio sintético en es/en/de generado con espeak-ng, listo para medir cuando haya modelo.
- Flujo de integración probado con un motor SIMULADO (script que escribe un SRT fijo): valida extracción de audio con ffmpeg, invocación, nombre de salida e importación; no valida ninguna calidad de reconocimiento.

## 3. Integración implementada
- `scripts/transcribe-local.mjs <vídeo|audio> [es|en|de|auto]`: ffmpeg → WAV 16 kHz mono → whisper.cpp → `<nombre>.auto.srt`. Variables `CEREBRO_WHISPER_BIN` y `CEREBRO_WHISPER_MODEL`.
- **Desactivada (código 2) si falta el motor o el modelo**; los subtítulos manuales siguen igual.
- El `.auto.srt` se importa con el panel de subtítulos existente; ahora muestra el aviso «GENERADOS AUTOMÁTICAMENTE… revísalos» y los SRT manuales no lo muestran. Una vez colocados, se editan como cualquier subtítulo.
- Privacidad: el audio no sale del equipo (sin red), el contenido hablado no se imprime ni se registra, el directorio temporal se borra siempre, el idioma se valida.
- Pruebas: `tests/transcribe-local-script.test.ts` (3) y comprobación E2E en M34 (39/39).

## 4. Validación
TypeScript 0 errores; ESLint 0 errores; E2E de módulos 39/39; subtítulos manuales (pegar, SRT, edición, grabado en MP4) siguen pasando.

## 5. Limitaciones
- Sin medición real de RAM/CPU/tiempo/precisión (modelos no descargables aquí).
- Es una herramienta local de línea de comandos; no hay botón dentro de la web (la beta pública no puede ejecutar procesos en el servidor).
- «Distinguir automáticos de corregidos» queda a nivel de archivo importado, no por subtítulo.

## 6. Próximos pasos
1. Con autorización de Jesús, en su PC: bajar `ggml-base-q5_1.bin` (57 MiB), medir RAM/tiempo/precisión con es/en/de y decidir tiny/base/small.
2. Marcar por subtítulo los editados a mano (campo `edited`).
3. Botón en la app de escritorio/local que invoque el script.
4. Mantener documentada la vulnerabilidad RLS: política de propiedad de proyecto pendiente de revisión antes de aplicarla en remoto; no publicar la beta sin ella.
