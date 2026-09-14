# Inventario Vial — App web (PWA)

App para hacer inventario fotográfico de carretera: toma fotos con el celular y les
"pega" automáticamente la progresiva (calculada desde tu ruta KMZ), coordenadas GPS,
precisión y fecha/hora.

## ⚠️ Requisito importante: HTTPS

La cámara y el GPS **solo funcionan si la app se abre desde una dirección `https://`**
(o `localhost`). Si abres el archivo `index.html` directamente desde el celular
(`file://...`), el navegador bloqueará la cámara y la ubicación. Por eso necesitas
publicar estos archivos en algún sitio con HTTPS antes de usarla. La forma más simple
y gratuita es GitHub Pages:

### Publicar en GitHub Pages (una sola vez, ~5 minutos)

1. Crea una cuenta gratuita en [github.com](https://github.com) si no tienes una.
2. Crea un repositorio nuevo (puede ser público), por ejemplo `inventario-vial`.
3. Sube **todos los archivos de esta carpeta** (`index.html`, `app.js`, `manifest.json`,
   `sw.js`, `jszip.min.js`, `icon-192.png`, `icon-512.png`) a la raíz del repositorio
   (botón "Add file" → "Upload files").
4. Ve a **Settings → Pages**, en "Source" elige la rama `main` y la carpeta `/root`,
   guarda.
5. Espera 1-2 minutos. GitHub te dará una URL parecida a:
   `https://tu-usuario.github.io/inventario-vial/`
6. Abre esa URL en Chrome desde tu celular Android.

Otras alternativas igual de válidas: Netlify Drop (arrastras la carpeta y listo),
Vercel, Cloudflare Pages, o tu propio hosting.

## Instalar como app en Android

1. Abre la URL en Chrome (Android).
2. Toca el menú (⋮) → **"Agregar a pantalla de inicio"** / "Instalar app".
3. Quedará un ícono como cualquier app, abre a pantalla completa, sin barra del
   navegador, y funciona offline después de la primera carga (salvo el GPS, que
   siempre necesita señal satelital, no internet).

## Cómo preparar el archivo KMZ

La app lee el KMZ/KML tal como lo exportas de Google Earth y soporta dos formatos:

- **Hitos de progresiva como puntos** (lo más preciso): un `Placemark` de tipo Punto
  por cada hito, con el nombre en formato `0+000`, `2+350`, `K0+540`, etc. La app
  detecta ese patrón automáticamente e interpola la progresiva entre los dos hitos
  más cercanos a tu posición GPS.
- **Una sola línea (ruta/trazo)** sin nombres de progresiva: la app calcula la
  progresiva como distancia acumulada a lo largo de la línea desde el primer punto.
  En este caso puedes indicar una **"Progresiva inicial"** en la app si el trazo no
  empieza en 0+000.

Sube el archivo desde la sección **"Ruta / progresiva (KMZ)"** dentro de la app.

## Cómo se usa

1. Carga el KMZ de la ruta.
2. Toca **"Activar GPS y cámara"** (te pedirá permisos una sola vez).
3. En la parte superior verás la progresiva actual en grande, como un letrero de
   kilometraje, junto con la precisión del GPS y el desvío respecto a la ruta.
4. Toca el botón circular para capturar fotos — puedes tomar tantas como necesites
   mientras la app siga activa, cada una queda en la galería inferior.
5. Al terminar, toca **"Descargar todo (ZIP)"**. El ZIP incluye:
   - Todas las fotos con la progresiva y coordenadas ya impresas en la imagen.
   - `registro_fotografico.csv` con el listado de todas las fotos (progresiva,
     coordenadas, precisión, desvío, fecha/hora) para llevarlo a Excel.
   - `puntos_fotos.kml` con un placemark por cada foto tomada, para reabrirlo en
     Google Earth y ver dónde quedó cada foto sobre la ruta.
6. Las fotos quedan guardadas en el celular mientras no toques "Vaciar", incluso si
   cierras la app por accidente (se restauran al volver a abrirla).

## Notas sobre precisión

- La precisión del GPS de un celular normal ronda 3–15 m al aire libre y puede
  empeorar bajo techo, en túneles o entre cerros. La app siempre muestra la
  precisión reportada; si el punto naranja del encabezado está en rojo, espera
  unos segundos o muévete a cielo abierto antes de fotografiar.
- El "desvío" que se muestra es la distancia perpendicular entre tu posición GPS y
  la ruta cargada — útil para saber si estás fotografiando justo sobre el eje de la
  vía o desde la berma/vereda.
- Si el KMZ trae varios tramos de línea separados, la app los trata como un solo
  recorrido continuo en el orden en que aparecen en el archivo. Para carreteras con
  ramales o tramos discontinuos, lo más confiable es usar el formato de puntos con
  progresiva nombrada.

## Archivos del proyecto

```
index.html       — interfaz de la app
app.js           — toda la lógica (GPS, cámara, cálculo de progresiva, exportación)
manifest.json    — hace que la app sea instalable en Android
sw.js            — permite que la app cargue offline tras la primera visita
jszip.min.js     — librería para leer el KMZ y generar el ZIP de exportación
icon-192.png / icon-512.png — ícono de la app
```

No hay ningún servidor ni backend: todo corre en el navegador del celular. Las
fotos nunca salen del teléfono hasta que tú decides descargarlas.
