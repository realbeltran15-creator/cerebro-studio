# Guion de prueba manual — recorrido completo (con tu sesión real)

Dónde: el Preview de la rama `fase1-seguridad` (Vercel, commit 79cfe00 o posterior). No uses Producción para estas pruebas.
Reglas: no pulses nada que cueste dinero, publique o programe. Donde un paso diga «NO PULSAR», solo mira que el botón esté desactivado o pida confirmación.
Para cada paso anota: ✔ funciona / ✘ falla (qué ves) / ? dudoso. Si algo falla, haz captura de pantalla.

## 0. Preparación
1. Abre el Preview e inicia sesión con tu cuenta. Comprueba que entras al Centro de operaciones.
2. Abre el menú lateral: cada enlace debe abrir su pantalla sin error 404.

## 1. Investigación → Proyecto
1. Radar de tendencias: elige país y categoría, «Ver tendencias». Esperado: lista de vídeos o aviso claro si YouTube no está configurado.
2. Oportunidades: abre una y pulsa «Crear proyecto». Esperado: se crea UNA vez (haz doble clic rápido: no debe duplicarse).
3. Proyectos: el proyecto aparece en la lista.

## 2. Guion → Storyboard
1. Guiones: escribe un hook y 2 secciones. Un «hecho verificado» sin fuente debe avisar.
2. Recarga la página a mitad de escribir: el texto no debe perderse sin aviso.
3. Genera el storyboard desde el guion: una escena por sección. Reordena y borra una escena (debe pedir confirmación).

## 3. Editor → MP4 → Biblioteca
1. Abre el Editor desde el proyecto («Abrir en el Editor»).
2. Añade 2–3 materiales de tu equipo (imágenes cortas). Mueve un clip, divide uno, deshaz (Ctrl+Z).
3. Sal del editor con cambios sin guardar: debe avisar.
4. Exporta un vídeo corto (10–20 s) a «descargar». Esperado: estado «Renderizando», al terminar el vídeo se abre y se ve.
   - En la lista de renders: «Completado y verificado» solo si el archivo está en la Biblioteca; si no, «Incierto» con la explicación.
5. Cancela una exportación a medias: debe quedar «Cancelado», no «Completado».
6. Biblioteca: el vídeo aparece, se reproduce y se puede descargar.

## 4. Estados y seguridad (solo mirar)
1. YouTube / Redes sociales: crea un borrador. NO PULSAR «Publicar». El estado debe ser «Preparado» o «Pendiente de aprobación», nunca «Completado».
2. Automatizaciones: ninguna ejecución en curso debe mostrarse como «Completado».
3. Costes: el gasto debe seguir en 0 €.

## 5. Móvil (opcional)
Abre el Preview en el móvil (o reduce la ventana a ~390 px de ancho): el menú, Proyectos, Guiones y Biblioteca no deben tener scroll horizontal ni botones cortados. El Editor manual es de escritorio: lo importante es que no se rompa.

## 6. Teclado (opcional)
Con solo Tab/Enter/Espacio: llega al menú, abre un proyecto y pulsa un botón. Debe verse el borde de foco.

Devuélveme la lista de ✘ y ? con capturas: los corrijo en la rama local.
