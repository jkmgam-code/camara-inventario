// =========================================================================
// Inventario Vial — lógica principal
// =========================================================================

// ---- Estado global ----
let referencePath = null;   // [{x,y,lat,lon,prog}] construido tras cargar la ruta
let namedMarkers = [];      // [{lat,lon,name}] puntos con nombre, para mostrar "cerca de..."
let routeLoaded = false;
let routeSourceType = null; // 'puntos' | 'linea'
let projectName = 'Inventario Vial';

let currentPosition = null; // {lat, lon, accuracy}
let watchId = null;

let stream = null;
let photos = [];            // {id, blob, url, progText, progMeters, lat, lon, accuracy, desvio, timestamp}
let photoCounter = 0;

// ---- Elementos DOM ----
const $ = (id) => document.getElementById(id);
const insecureBanner = $('insecureBanner');
const permBanner = $('permBanner');
const progText = $('progText');
const progMeta = $('progMeta');
const activateBtn = $('activateBtn');
const kmzInput = $('kmzInput');
const startOffsetInput = $('startOffset');
const projectNameInput = $('projectName');
const routeStatus = $('routeStatus');
const video = $('video');
const videoPlaceholder = $('videoPlaceholder');
const camToggle = $('camToggle');
const shutterBtn = $('shutterBtn');
const shutterHint = $('shutterHint');
const galleryGrid = $('galleryGrid');
const galleryTitle = $('galleryTitle');
const emptyState = $('emptyState');
const downloadAllBtn = $('downloadAllBtn');
const clearBtn = $('clearBtn');
const gpsDot = $('gpsDot');
const gpsLabel = $('gpsLabel');
const canvas = $('canvas');
const lightbox = $('lightbox');
const lbImg = $('lbImg');
const lbMeta = $('lbMeta');
const lbDownload = $('lbDownload');
const lbDelete = $('lbDelete');
const lbClose = $('lbClose');

let lightboxPhotoId = null;

// =========================================================================
// IndexedDB — persistencia de fotos durante la sesión de campo
// =========================================================================
let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open('inventario-vial-db', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('photos', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
async function dbPut(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    tx.objectStore('photos').put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function dbDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    tx.objectStore('photos').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function dbClear() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    tx.objectStore('photos').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function dbGetAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readonly');
    const req = tx.objectStore('photos').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function restoreSession() {
  try {
    const records = await dbGetAll();
    if (!records.length) return;
    records.sort((a, b) => a.id - b.id);
    for (const r of records) {
      photos.push({ ...r, url: URL.createObjectURL(r.blob) });
      photoCounter = Math.max(photoCounter, r.id + 1);
    }
    renderGallery();
  } catch (e) { /* IndexedDB no disponible: la sesión no persiste, no es crítico */ }
}

// =========================================================================
// Utilidades geográficas
// =========================================================================
function toRad(d) { return (d * Math.PI) / 180; }

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function toXY(lat, lon, refLat, refLon) {
  const x = (lon - refLon) * Math.cos(toRad(refLat)) * 111320;
  const y = (lat - refLat) * 110540;
  return { x, y };
}

function parseProgresivaFromText(text) {
  if (!text) return null;
  const m = text.match(/(\d+)\s*\+\s*(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const km = parseInt(m[1], 10);
  const meters = parseFloat(m[2].replace(',', '.'));
  if (isNaN(km) || isNaN(meters)) return null;
  return km * 1000 + meters;
}

function formatProgresiva(m) {
  if (m == null || isNaN(m)) return '— — —';
  const sign = m < 0 ? '-' : '';
  // redondear a 2 decimales antes de separar km/m para evitar que el resto
  // redondee hasta 1000.00 (ej: 999.999 debe verse "1+000.00", no "0+1000.00")
  m = Math.round(Math.abs(m) * 100) / 100;
  const km = Math.floor(m / 1000);
  const rem = m - km * 1000;
  return `${sign}${km}+${rem.toFixed(2).padStart(6, '0')}`;
}

// =========================================================================
// Carga y parseo de KMZ / KML
// =========================================================================
kmzInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  routeStatus.className = 'status-line';
  routeStatus.textContent = 'Leyendo archivo…';
  try {
    const buffer = await file.arrayBuffer();
    let kmlText = null;

    try {
      const zip = await JSZip.loadAsync(buffer);
      const entryName = Object.keys(zip.files).find((n) => n.toLowerCase().endsWith('.kml'));
      if (!entryName) throw new Error('El KMZ no contiene un archivo .kml');
      kmlText = await zip.file(entryName).async('string');
    } catch (zipErr) {
      // No es un ZIP válido: puede ser un .kml plano
      kmlText = new TextDecoder('utf-8').decode(buffer);
    }

    parseKmlAndBuildRoute(kmlText);
  } catch (err) {
    routeStatus.className = 'status-line bad';
    routeStatus.textContent = 'No se pudo leer el archivo. Verifica que sea un KMZ/KML válido exportado de Google Earth.';
    console.error(err);
  }
});

function parseKmlAndBuildRoute(kmlText) {
  const xml = new DOMParser().parseFromString(kmlText, 'text/xml');
  if (xml.querySelector('parsererror')) {
    routeStatus.className = 'status-line bad';
    routeStatus.textContent = 'El archivo KML no tiene un formato válido.';
    return;
  }

  const docNameEl = xml.querySelector('Document > name, kml > name');
  if (docNameEl && docNameEl.textContent.trim() && !projectNameInput.value) {
    projectNameInput.value = docNameEl.textContent.trim();
  }

  const placemarks = Array.from(xml.getElementsByTagName('Placemark'));
  const points = [];   // {lat, lon, name, prog}
  const lineCoords = []; // {lat, lon} concatenados en orden de documento

  for (const pm of placemarks) {
    const nameEl = pm.getElementsByTagName('name')[0];
    const name = nameEl ? nameEl.textContent.trim() : '';

    const pointEl = pm.getElementsByTagName('Point')[0];
    if (pointEl) {
      const coordEl = pointEl.getElementsByTagName('coordinates')[0];
      if (coordEl) {
        const parts = coordEl.textContent.trim().split(',');
        const lon = parseFloat(parts[0]);
        const lat = parseFloat(parts[1]);
        if (!isNaN(lat) && !isNaN(lon)) {
          points.push({ lat, lon, name, prog: parseProgresivaFromText(name) });
        }
      }
    }

    const lineEls = pm.getElementsByTagName('LineString');
    for (const lineEl of lineEls) {
      const coordEl = lineEl.getElementsByTagName('coordinates')[0];
      if (!coordEl) continue;
      const tokens = coordEl.textContent.trim().split(/\s+/);
      for (const tok of tokens) {
        const parts = tok.split(',');
        const lon = parseFloat(parts[0]);
        const lat = parseFloat(parts[1]);
        if (!isNaN(lat) && !isNaN(lon)) lineCoords.push({ lat, lon });
      }
    }
  }

  namedMarkers = points.filter((p) => p.name);

  const parsedPoints = points.filter((p) => p.prog != null);
  const startOffset = parseFloat(startOffsetInput.value) || 0;

  if (parsedPoints.length >= 2) {
    referencePath = parsedPoints.map((p) => ({ lat: p.lat, lon: p.lon, prog: p.prog }));
    routeSourceType = 'puntos';
  } else if (lineCoords.length >= 2 || points.length >= 2) {
    const verts = lineCoords.length >= 2 ? lineCoords : points;
    referencePath = [];
    let cum = startOffset;
    for (let i = 0; i < verts.length; i++) {
      if (i > 0) cum += haversine(verts[i - 1].lat, verts[i - 1].lon, verts[i].lat, verts[i].lon);
      referencePath.push({ lat: verts[i].lat, lon: verts[i].lon, prog: cum });
    }
    routeSourceType = 'linea';
  } else {
    referencePath = null;
  }

  if (!referencePath || referencePath.length < 2) {
    routeLoaded = false;
    routeStatus.className = 'status-line bad';
    routeStatus.textContent = 'No se encontraron puntos ni una línea utilizable dentro del archivo. Revisa que el KMZ contenga la ruta o los hitos de progresiva.';
    return;
  }

  routeLoaded = true;
  const totalLen = referencePath[referencePath.length - 1].prog - referencePath[0].prog;
  routeStatus.className = 'status-line ok';
  if (routeSourceType === 'puntos') {
    routeStatus.textContent = `Ruta cargada: ${parsedPoints.length} hitos de progresiva detectados (${formatProgresiva(referencePath[0].prog)} a ${formatProgresiva(referencePath[referencePath.length - 1].prog)}).`;
  } else {
    routeStatus.textContent = `Ruta cargada: ${referencePath.length} puntos, ${(totalLen / 1000).toFixed(2)} km de longitud. La progresiva se calcula por distancia acumulada desde el punto inicial (${formatProgresiva(startOffset)}).`;
  }

  updateProgresivaPanel();
}

// =========================================================================
// Cálculo de progresiva a partir de la posición GPS
// =========================================================================
function computeChainage(lat, lon) {
  if (!referencePath || referencePath.length < 2) return null;
  const refLat = referencePath[0].lat;
  const refLon = referencePath[0].lon;
  const pts = referencePath.map((p) => ({ ...toXY(p.lat, p.lon, refLat, refLon), prog: p.prog }));
  const cur = toXY(lat, lon, refLat, refLon);

  let best = { dist: Infinity, prog: null };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) continue;
    let t = ((cur.x - a.x) * dx + (cur.y - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const projX = a.x + t * dx, projY = a.y + t * dy;
    const dist = Math.hypot(cur.x - projX, cur.y - projY);
    if (dist < best.dist) {
      best = { dist, prog: a.prog + t * (b.prog - a.prog) };
    }
  }
  if (best.prog == null) return null;

  let nearestMarker = null;
  if (namedMarkers.length) {
    let minD = Infinity;
    for (const mk of namedMarkers) {
      const d = haversine(lat, lon, mk.lat, mk.lon);
      if (d < minD) { minD = d; nearestMarker = { name: mk.name, dist: d }; }
    }
  }

  return { prog: best.prog, desvio: best.dist, nearestMarker };
}

function updateProgresivaPanel() {
  if (!currentPosition) {
    progText.textContent = '— — —';
    progText.classList.add('empty');
    progMeta.textContent = routeLoaded ? 'Esperando señal GPS…' : 'Carga una ruta KMZ y activa el GPS';
    return;
  }
  if (!routeLoaded) {
    progText.textContent = '— — —';
    progText.classList.add('empty');
    progMeta.innerHTML = `<b>${currentPosition.lat.toFixed(6)}, ${currentPosition.lon.toFixed(6)}</b> · precisión ±${Math.round(currentPosition.accuracy)} m — sin ruta cargada`;
    return;
  }
  const ch = computeChainage(currentPosition.lat, currentPosition.lon);
  if (!ch) {
    progText.textContent = '— — —';
    progText.classList.add('empty');
    progMeta.textContent = 'No se pudo calcular la progresiva.';
    return;
  }
  progText.classList.remove('empty');
  progText.textContent = formatProgresiva(ch.prog);
  const parts = [
    `±<b>${Math.round(currentPosition.accuracy)} m</b> GPS`,
    `desvío a ruta <b>${Math.round(ch.desvio)} m</b>`,
  ];
  if (ch.nearestMarker) {
    parts.push(`cerca de <b>${ch.nearestMarker.name}</b> (${Math.round(ch.nearestMarker.dist)} m)`);
  }
  progMeta.innerHTML = parts.join(' · ');
}

// =========================================================================
// GPS
// =========================================================================
function updateGpsDot() {
  if (!currentPosition) { gpsDot.className = 'gps-dot'; gpsLabel.textContent = 'GPS inactivo'; return; }
  const acc = currentPosition.accuracy;
  if (acc <= 10) { gpsDot.className = 'gps-dot ok'; }
  else if (acc <= 25) { gpsDot.className = 'gps-dot warn'; }
  else { gpsDot.className = 'gps-dot bad'; }
  gpsLabel.textContent = `±${Math.round(acc)} m`;
}

function startGps() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) { reject(new Error('Este navegador no soporta geolocalización.')); return; }
    let resolved = false;
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        currentPosition = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
        updateGpsDot();
        updateProgresivaPanel();
        if (!resolved) { resolved = true; resolve(); }
      },
      (err) => {
        if (!resolved) { resolved = true; reject(err); }
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 }
    );
  });
}

// =========================================================================
// Cámara
// =========================================================================
async function startCameraStream() {
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
  });
  video.srcObject = stream;
  videoPlaceholder.style.display = 'none';
  camToggle.style.display = 'block';
  camToggle.textContent = 'Detener';
  shutterBtn.disabled = false;
  shutterHint.textContent = 'Sostén el celular en horizontal · toca para capturar';
}

function stopCameraStream() {
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  video.srcObject = null;
  videoPlaceholder.style.display = 'flex';
  videoPlaceholder.textContent = 'Cámara detenida';
  camToggle.textContent = 'Reanudar';
  shutterBtn.disabled = true;
  shutterHint.textContent = 'Reanuda la cámara para seguir capturando';
}

camToggle.addEventListener('click', async () => {
  if (stream) {
    stopCameraStream();
  } else {
    try { await startCameraStream(); } catch (e) { showPermError(e); }
  }
});

// ---- Activar todo (un solo gesto del usuario) ----
activateBtn.addEventListener('click', async () => {
  activateBtn.disabled = true;
  activateBtn.textContent = 'Activando…';
  permBanner.classList.remove('show');
  try {
    await Promise.all([startGps(), startCameraStream()]);
    activateBtn.style.display = 'none';
  } catch (e) {
    showPermError(e);
    activateBtn.disabled = false;
    activateBtn.textContent = 'Reintentar';
  }
});

function showPermError(e) {
  let msg = 'No se pudo activar el GPS o la cámara.';
  if (e && e.code === 1) msg = 'Permiso denegado. Habilita la cámara y la ubicación para este sitio en los ajustes del navegador.';
  else if (e && e.code === 2) msg = 'No se pudo obtener la posición GPS. Sal a un lugar con mejor señal.';
  else if (e && e.code === 3) msg = 'Tiempo de espera agotado esperando el GPS. Intenta de nuevo.';
  else if (e && e.name === 'NotAllowedError') msg = 'Permiso de cámara denegado. Habilítalo en los ajustes del navegador.';
  else if (e && e.name === 'NotFoundError') msg = 'No se encontró una cámara en este dispositivo.';
  permBanner.textContent = msg;
  permBanner.classList.add('show');
}

// =========================================================================
// Captura de foto con overlay de progresiva
// =========================================================================
shutterBtn.addEventListener('click', capturePhoto);

function drawOverlay(ctx, w, h, data) {
  // Recuadro reducido (antes 17% de alto) y fondo más claro (antes negro casi sólido)
  const bandH = Math.round(h * 0.13);
  ctx.fillStyle = 'rgba(48,46,42,0.55)';
  ctx.fillRect(0, h - bandH, w, bandH);

  const bigSize = Math.round(w * 0.050);
  const smallSize = Math.round(w * 0.021);
  const padX = Math.round(w * 0.035);
  const padTop = Math.round(bandH * 0.18);

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#E85D04';
  ctx.font = `bold ${bigSize}px 'Courier New', monospace`;
  const line1y = h - bandH + padTop + bigSize;
  ctx.fillText(data.progText, padX, line1y);

  // Solo coordenadas y fecha/hora — sin precisión GPS, sin desvío, sin nombre de archivo
  ctx.fillStyle = '#F4F1EA';
  ctx.font = `${smallSize}px sans-serif`;
  const line2y = line1y + smallSize + 6;
  ctx.fillText(`${data.lat.toFixed(6)}, ${data.lon.toFixed(6)}`, padX, line2y);

  const line3y = line2y + smallSize + 5;
  ctx.fillText(data.timestamp, padX, line3y);
}

async function capturePhoto() {
  if (!stream) return;
  shutterBtn.disabled = true;
  try {
    let bitmap = null;

    // Método preferido: captura fotográfica nativa del teléfono. A diferencia de
    // dibujar el <video> en el canvas (que puede guardar el frame crudo del sensor
    // sin la rotación real del teléfono), esto usa el mismo pipeline que la app de
    // Cámara del celular y respeta la orientación real vía EXIF — corrige el bug de
    // fotos giradas y de paso entrega mayor resolución.
    const track = stream.getVideoTracks()[0];
    if (window.ImageCapture && track) {
      try {
        const imageCapture = new ImageCapture(track);
        const blob = await imageCapture.takePhoto();
        bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      } catch (e) {
        bitmap = null; // este dispositivo no lo soporta bien: usamos el método alterno
      }
    }

    let w, h;
    if (bitmap) { w = bitmap.width; h = bitmap.height; }
    else { w = video.videoWidth; h = video.videoHeight; }
    if (!w || !h) { shutterBtn.disabled = false; return; }

    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (bitmap) ctx.drawImage(bitmap, 0, 0, w, h);
    else ctx.drawImage(video, 0, 0, w, h);

    const now = new Date();
    const timestamp = now.toLocaleString('es-PE', { hour12: false });

    let progMeters = null, progTextStr = 'Sin ubicación', lat = null, lon = null, accuracy = null, desvio = null;
    if (currentPosition) {
      lat = currentPosition.lat; lon = currentPosition.lon; accuracy = currentPosition.accuracy;
      if (routeLoaded) {
        const ch = computeChainage(lat, lon);
        if (ch) { progMeters = ch.prog; progTextStr = formatProgresiva(ch.prog); desvio = ch.desvio; }
      } else {
        progTextStr = 'Sin ruta';
      }
    }

    // accuracy y desvio se siguen guardando (van en el CSV/KML exportado), solo ya
    // no se imprimen sobre la imagen
    drawOverlay(ctx, w, h, {
      progText: progTextStr,
      lat: lat ?? 0,
      lon: lon ?? 0,
      timestamp,
    });

    canvas.toBlob(async (blob) => {
      const id = photoCounter++;
      const record = {
        id, blob,
        progText: progTextStr, progMeters,
        lat, lon, accuracy, desvio,
        timestamp: now.toISOString(),
      };
      photos.push({ ...record, url: URL.createObjectURL(blob) });
      dbPut(record).catch(() => {});
      renderGallery();
      flashShutter();
      shutterBtn.disabled = false;
    }, 'image/jpeg', 0.92);
  } catch (e) {
    console.error('Error al capturar la foto:', e);
    shutterBtn.disabled = false;
  }
}

function flashShutter() {
  shutterBtn.style.opacity = '0.3';
  setTimeout(() => { shutterBtn.style.opacity = '1'; }, 120);
}

// =========================================================================
// Galería
// =========================================================================
function sanitizeForFilename(s) {
  return (s || '').replace(/[^0-9+.\-]/g, '');
}

function photoFilename(p) {
  const idx = String(p.id + 1).padStart(4, '0');
  return `foto_${idx}_${sanitizeForFilename(p.progText) || 'sinubi'}.jpg`;
}

function renderGallery() {
  galleryTitle.textContent = `Fotos capturadas (${photos.length})`;
  downloadAllBtn.disabled = photos.length === 0;
  emptyState.style.display = photos.length === 0 ? 'block' : 'none';
  galleryGrid.innerHTML = '';
  for (const p of [...photos].reverse()) {
    const div = document.createElement('div');
    div.className = 'thumb';
    div.innerHTML = `
      <img src="${p.url}" alt="Foto ${p.progText}">
      <span class="chip">${p.progText}</span>
      <button class="del" data-id="${p.id}" aria-label="Eliminar">✕</button>
    `;
    div.querySelector('img').addEventListener('click', () => openLightbox(p.id));
    div.querySelector('.del').addEventListener('click', (e) => { e.stopPropagation(); deletePhoto(p.id); });
    galleryGrid.appendChild(div);
  }
}

async function deletePhoto(id) {
  const idx = photos.findIndex((p) => p.id === id);
  if (idx === -1) return;
  URL.revokeObjectURL(photos[idx].url);
  photos.splice(idx, 1);
  await dbDelete(id).catch(() => {});
  renderGallery();
}

function openLightbox(id) {
  const p = photos.find((x) => x.id === id);
  if (!p) return;
  lightboxPhotoId = id;
  lbImg.src = p.url;
  lbMeta.textContent = `${p.progText}  ·  ${p.lat != null ? p.lat.toFixed(6) + ', ' + p.lon.toFixed(6) : 'sin coordenadas'}  ·  ${new Date(p.timestamp).toLocaleString('es-PE')}`;
  lbDownload.href = p.url;
  lbDownload.download = photoFilename(p);
  lightbox.classList.add('show');
}
lbClose.addEventListener('click', () => lightbox.classList.remove('show'));
lightbox.addEventListener('click', (e) => { if (e.target === lightbox) lightbox.classList.remove('show'); });
lbDelete.addEventListener('click', async () => {
  if (lightboxPhotoId != null) await deletePhoto(lightboxPhotoId);
  lightbox.classList.remove('show');
});

// =========================================================================
// Exportar todo (ZIP con fotos + CSV + KML de puntos)
// =========================================================================
downloadAllBtn.addEventListener('click', async () => {
  if (!photos.length) return;
  downloadAllBtn.disabled = true;
  downloadAllBtn.textContent = 'Generando ZIP…';
  try {
    const zip = new JSZip();
    const folder = zip.folder('fotos');
    const ordered = [...photos].sort((a, b) => a.id - b.id);

    const csvRows = ['N,Archivo,Progresiva,Latitud,Longitud,Precision_GPS_m,Desvio_Ruta_m,Fecha_Hora'];
    let kmlPlacemarks = '';

    ordered.forEach((p, i) => {
      const fname = photoFilename(p);
      folder.file(fname, p.blob);
      csvRows.push([
        i + 1, fname, p.progText,
        p.lat != null ? p.lat.toFixed(7) : '',
        p.lon != null ? p.lon.toFixed(7) : '',
        p.accuracy != null ? Math.round(p.accuracy) : '',
        p.desvio != null ? Math.round(p.desvio) : '',
        new Date(p.timestamp).toLocaleString('es-PE'),
      ].join(','));

      if (p.lat != null) {
        kmlPlacemarks += `
    <Placemark>
      <name>${escapeXml(p.progText)}</name>
      <description>${escapeXml(fname)} — ${escapeXml(new Date(p.timestamp).toLocaleString('es-PE'))}</description>
      <Point><coordinates>${p.lon},${p.lat},0</coordinates></Point>
    </Placemark>`;
      }
    });

    zip.file('registro_fotografico.csv', csvRows.join('\n'));

    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(projectNameInput.value.trim() || 'Inventario Vial')} — puntos fotográficos</name>${kmlPlacemarks}
  </Document>
</kml>`;
    zip.file('puntos_fotos.kml', kml);

    const content = await zip.generateAsync({ type: 'blob' });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const safeProject = (projectNameInput.value.trim() || 'inventario_vial').replace(/[^a-z0-9_\-]/gi, '_');
    triggerDownload(content, `${safeProject}_${stamp}.zip`);
  } finally {
    downloadAllBtn.disabled = photos.length === 0;
    downloadAllBtn.textContent = 'Descargar todo (ZIP)';
  }
});

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// =========================================================================
// Vaciar sesión
// =========================================================================
clearBtn.addEventListener('click', async () => {
  if (!photos.length) return;
  if (!confirm(`¿Eliminar las ${photos.length} fotos de esta sesión? Esta acción no se puede deshacer (asegúrate de haberlas descargado).`)) return;
  for (const p of photos) URL.revokeObjectURL(p.url);
  photos = [];
  await dbClear().catch(() => {});
  renderGallery();
});

// =========================================================================
// Inicio
// =========================================================================
if (!window.isSecureContext) {
  insecureBanner.classList.add('show');
}

if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

restoreSession();
updateGpsDot();
updateProgresivaPanel();
