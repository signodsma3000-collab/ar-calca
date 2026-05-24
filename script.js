/* ═══════════════════════════════════════════════════════════════
   AR CALCA — script.js
   Motor de realidad aumentada para dibujo / calca en móvil
   Tecnología: Three.js + DeviceMotion/Orientation (fallback ARCore WebXR)
   ═══════════════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────────────────────
   ESTADO GLOBAL
   ───────────────────────────────────────────────────────────── */
const STATE = {
  started:      false,   // cámara activa
  hasImage:     false,   // imagen cargada
  locked:       false,   // posición bloqueada
  anchored:     false,   // anclada en espacio
  gridVisible:  false,   // cuadrícula activa
  imageLoaded:  null,    // HTMLImageElement
  imageName:    '',

  // Transformaciones de la imagen AR
  tx: 0, ty: 0,          // posición 2D en el canvas (relative center)
  scale: 1.0,
  rotation: 0,           // en radianes
  opacity: 0.85,

  // Offset de anclaje (para simular estabilización)
  anchorTx: 0, anchorTy: 0,
  deviceBasePitch: null, deviceBaseRoll: null,
  pitchSensitivity: 0.4,   // ajusta la sensibilidad de seguimiento
  rollSensitivity:  0.4,
};

/* ─────────────────────────────────────────────────────────────
   ELEMENTOS DOM
   ───────────────────────────────────────────────────────────── */
const $   = id => document.getElementById(id);
const DOM = {
  splash:       $('splash'),
  btnStart:     $('btn-start'),
  camera:       $('camera-feed'),
  arCanvas:     $('ar-canvas'),
  gridCanvas:   $('grid-canvas'),
  uiOverlay:    $('ui-overlay'),
  statusLabel:  $('status-label'),
  btnUpload:    $('btn-upload'),
  btnGrid:      $('btn-grid'),
  btnLock:      $('btn-lock'),
  lockOpen:     $('lock-icon-open'),
  lockClosed:   $('lock-icon-closed'),
  controlsPanel:$('controls-panel'),
  sliderOpacity:$('slider-opacity'),
  valOpacity:   $('val-opacity'),
  sliderScale:  $('slider-scale'),
  valScale:     $('val-scale'),
  sliderRotate: $('slider-rotate'),
  valRotate:    $('val-rotate'),
  btnReset:     $('btn-reset'),
  btnAnchor:    $('btn-anchor'),
  crosshair:    $('crosshair'),
  touchHint:    $('touch-hint'),
  fileInput:    $('file-input'),
  modalError:   $('modal-error'),
  modalTitle:   $('modal-title'),
  modalMsg:     $('modal-msg'),
  modalClose:   $('modal-close'),
};

/* ─────────────────────────────────────────────────────────────
   CANVAS 2D RENDERER  (sin Three.js para máxima compatibilidad)
   Usamos un canvas 2D sobre el video. Más estable en Android.
   ───────────────────────────────────────────────────────────── */
let ctx2d, W, H;

function initCanvas() {
  ctx2d = DOM.arCanvas.getContext('2d');
  resizeCanvases();
  window.addEventListener('resize', resizeCanvases);
  window.addEventListener('orientationchange', () => setTimeout(resizeCanvases, 300));
}

function resizeCanvases() {
  W = DOM.arCanvas.width  = DOM.gridCanvas.width  = window.innerWidth;
  H = DOM.arCanvas.height = DOM.gridCanvas.height = window.innerHeight;
  // Posición inicial = centro de pantalla
  if (!STATE.anchored) {
    STATE.tx = W / 2;
    STATE.ty = H / 2;
  }
  if (STATE.gridVisible) drawGrid();
}

/* ─────────────────────────────────────────────────────────────
   LOOP DE RENDER PRINCIPAL
   ───────────────────────────────────────────────────────────── */
let rafId;

function renderLoop() {
  rafId = requestAnimationFrame(renderLoop);
  ctx2d.clearRect(0, 0, W, H);
  if (STATE.hasImage && STATE.imageLoaded) {
    drawARImage();
  }
}

function drawARImage() {
  const img  = STATE.imageLoaded;
  const ox   = STATE.tx;
  const oy   = STATE.ty;
  const sc   = STATE.scale;
  const rot  = STATE.rotation;
  const opa  = STATE.opacity;

  // Calcular dimensiones máximas manteniendo aspect ratio
  const maxW = W * 0.7;
  const maxH = H * 0.7;
  const ratio = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
  const dw = img.naturalWidth  * ratio * sc;
  const dh = img.naturalHeight * ratio * sc;

  ctx2d.save();
  ctx2d.globalAlpha = opa;
  ctx2d.translate(ox, oy);
  ctx2d.rotate(rot);
  ctx2d.drawImage(img, -dw / 2, -dh / 2, dw, dh);

  // Borde sutil cuando no está bloqueada
  if (!STATE.locked) {
    ctx2d.strokeStyle = 'rgba(0,229,160,0.4)';
    ctx2d.lineWidth = 1.5;
    ctx2d.setLineDash([6, 4]);
    ctx2d.strokeRect(-dw / 2, -dh / 2, dw, dh);
    ctx2d.setLineDash([]);

    // Esquinas de selección
    const cs = 12;
    ctx2d.strokeStyle = 'rgba(0,229,160,0.9)';
    ctx2d.lineWidth = 2;
    const corners = [
      [-dw/2, -dh/2], [dw/2, -dh/2],
      [-dw/2,  dh/2], [dw/2,  dh/2],
    ];
    corners.forEach(([cx, cy]) => {
      ctx2d.beginPath();
      ctx2d.moveTo(cx + Math.sign(cx) * cs, cy);
      ctx2d.lineTo(cx, cy);
      ctx2d.lineTo(cx, cy + Math.sign(cy) * cs);
      ctx2d.stroke();
    });
  }

  ctx2d.restore();
}

/* ─────────────────────────────────────────────────────────────
   ESTABILIZACIÓN CON SENSOR DE ORIENTACIÓN
   Simula "ancla" moviendo ligeramente la imagen opuesto al giro
   del dispositivo — efecto similar a AR tracking básico
   ───────────────────────────────────────────────────────────── */
let lastAlpha = 0, lastBeta = 0, lastGamma = 0;
let orientationSupported = false;

function initOrientation() {
  // iOS 13+ requiere permiso explícito
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    // Se solicitará al anclar
    return;
  }
  window.addEventListener('deviceorientation', onOrientation, true);
  orientationSupported = true;
}

function requestOrientationPermission() {
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission()
      .then(r => {
        if (r === 'granted') {
          window.addEventListener('deviceorientation', onOrientation, true);
          orientationSupported = true;
        }
      }).catch(() => {});
  }
}

function onOrientation(e) {
  if (!STATE.anchored || STATE.locked) return;

  const beta  = e.beta  || 0;   // inclinación adelante/atrás
  const gamma = e.gamma || 0;   // inclinación lateral

  // Guardar referencia al momento de anclar
  if (STATE.deviceBasePitch === null) {
    STATE.deviceBasePitch = beta;
    STATE.deviceBaseRoll  = gamma;
  }

  const dPitch = beta  - STATE.deviceBasePitch;
  const dRoll  = gamma - STATE.deviceBaseRoll;

  // Compensar movimiento: mover imagen en dirección contraria
  const compX = -dRoll  * STATE.rollSensitivity  * (W / 100);
  const compY = -dPitch * STATE.pitchSensitivity * (H / 100);

  STATE.tx = STATE.anchorTx + compX;
  STATE.ty = STATE.anchorTy + compY;

  lastBeta  = beta;
  lastGamma = gamma;
}

/* ─────────────────────────────────────────────────────────────
   CÁMARA TRASERA
   ───────────────────────────────────────────────────────────── */
async function startCamera() {
  const constraints = {
    video: {
      facingMode: { exact: 'environment' },   // cámara trasera
      width:  { ideal: 1920 },
      height: { ideal: 1080 },
    },
    audio: false,
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    DOM.camera.srcObject = stream;
    await DOM.camera.play();
    STATE.started = true;
    DOM.splash.style.display = 'none';
    initCanvas();
    initOrientation();
    renderLoop();
    updateStatus('Sin imagen');
  } catch (err) {
    // Fallback: intentar sin "exact" (algunos Android)
    try {
      const stream2 = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }, audio: false,
      });
      DOM.camera.srcObject = stream2;
      await DOM.camera.play();
      STATE.started = true;
      DOM.splash.style.display = 'none';
      initCanvas();
      initOrientation();
      renderLoop();
      updateStatus('Sin imagen');
    } catch (err2) {
      showError('Cámara no disponible',
        `No se pudo acceder a la cámara trasera.\n${err2.message}\n\nAsegúrate de abrir esta página desde Chrome en Android con HTTPS.`);
    }
  }
}

/* ─────────────────────────────────────────────────────────────
   CARGA DE IMAGEN
   ───────────────────────────────────────────────────────────── */
function loadImage(file) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    STATE.imageLoaded = img;
    STATE.imageName   = file.name;
    STATE.hasImage    = true;
    // Centrar en pantalla al cargar
    STATE.tx = W / 2; STATE.ty = H / 2;
    STATE.scale    = 1.0;
    STATE.rotation = 0;
    STATE.opacity  = 0.85;
    STATE.anchored = false;
    STATE.locked   = false;
    STATE.deviceBasePitch = null;
    // Reset sliders
    DOM.sliderOpacity.value = 85;  DOM.valOpacity.textContent = '85%';
    DOM.sliderScale.value   = 100; DOM.valScale.textContent   = '100%';
    DOM.sliderRotate.value  = 0;   DOM.valRotate.textContent  = '0°';
    // Mostrar controles
    DOM.controlsPanel.classList.remove('hidden');
    DOM.touchHint.classList.remove('hidden');
    setTimeout(() => DOM.touchHint.classList.add('hidden'), 4000);
    DOM.crosshair.style.display = 'none';
    setLockUI(false);
    updateStatus(file.name.length > 14 ? file.name.substring(0,12)+'…' : file.name);
    URL.revokeObjectURL(url);
  };
  img.onerror = () => showError('Error de imagen', 'No se pudo cargar la imagen. Usa PNG o JPG.');
  img.src = url;
}

/* ─────────────────────────────────────────────────────────────
   GESTOS TÁCTILES
   Maneja: drag (1 dedo), pinch-scale (2 dedos), rotate (2 dedos)
   ───────────────────────────────────────────────────────────── */
let touch = {
  active:    false,
  startX:    0, startY: 0,
  startTx:   0, startTy: 0,
  prevDist:  0,
  prevAngle: 0,
  prevScale: 1,
  prevRot:   0,
};

function getCenter(touches) {
  return {
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2,
  };
}
function getDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}
function getAngle(touches) {
  return Math.atan2(
    touches[1].clientY - touches[0].clientY,
    touches[1].clientX - touches[0].clientX,
  );
}

DOM.arCanvas.style.pointerEvents = 'none';   // canvas no captura
DOM.uiOverlay.style.pointerEvents = 'none';  // overlay no captura

// El área de captura de gestos es el video (fondo)
const gestureArea = DOM.camera;
gestureArea.style.zIndex = '5'; // encima del video, debajo del UI

gestureArea.addEventListener('touchstart', e => {
  if (!STATE.hasImage || STATE.locked) return;
  e.preventDefault();
  touch.active = true;
  if (e.touches.length === 1) {
    touch.startX  = e.touches[0].clientX;
    touch.startY  = e.touches[0].clientY;
    touch.startTx = STATE.tx;
    touch.startTy = STATE.ty;
  } else if (e.touches.length === 2) {
    touch.prevDist  = getDist(e.touches);
    touch.prevAngle = getAngle(e.touches);
    touch.prevScale = STATE.scale;
    touch.prevRot   = STATE.rotation;
  }
}, { passive: false });

gestureArea.addEventListener('touchmove', e => {
  if (!STATE.hasImage || STATE.locked || !touch.active) return;
  e.preventDefault();
  if (e.touches.length === 1) {
    // MOVER
    const dx = e.touches[0].clientX - touch.startX;
    const dy = e.touches[0].clientY - touch.startY;
    STATE.tx = touch.startTx + dx;
    STATE.ty = touch.startTy + dy;
    // Si está anclada, actualizar posición base de ancla
    if (STATE.anchored) {
      STATE.anchorTx = STATE.tx;
      STATE.anchorTy = STATE.ty;
      STATE.deviceBasePitch = null; // re-calibrar orientación
    }
  } else if (e.touches.length === 2) {
    // ESCALAR
    const dist  = getDist(e.touches);
    const angle = getAngle(e.touches);
    const scaleFactor = dist / touch.prevDist;
    STATE.scale    = Math.max(0.05, Math.min(5, touch.prevScale * scaleFactor));
    // ROTAR
    const dAngle = angle - touch.prevAngle;
    STATE.rotation = touch.prevRot + dAngle;
    // Sincronizar sliders
    DOM.sliderScale.value  = Math.round(STATE.scale * 100);
    DOM.valScale.textContent = Math.round(STATE.scale * 100) + '%';
    DOM.sliderRotate.value = Math.round(((STATE.rotation % (Math.PI*2)) + Math.PI*2) % (Math.PI*2) * 180 / Math.PI);
    DOM.valRotate.textContent = DOM.sliderRotate.value + '°';
  }
}, { passive: false });

gestureArea.addEventListener('touchend', e => {
  if (e.touches.length < 2) {
    touch.prevDist  = 0;
    touch.prevAngle = 0;
  }
  if (e.touches.length === 0) touch.active = false;
}, { passive: true });

/* ─────────────────────────────────────────────────────────────
   SLIDERS DE CONTROL
   ───────────────────────────────────────────────────────────── */
DOM.sliderOpacity.addEventListener('input', () => {
  STATE.opacity = DOM.sliderOpacity.value / 100;
  DOM.valOpacity.textContent = DOM.sliderOpacity.value + '%';
});
DOM.sliderScale.addEventListener('input', () => {
  STATE.scale = DOM.sliderScale.value / 100;
  DOM.valScale.textContent = DOM.sliderScale.value + '%';
});
DOM.sliderRotate.addEventListener('input', () => {
  STATE.rotation = DOM.sliderRotate.value * Math.PI / 180;
  DOM.valRotate.textContent = DOM.sliderRotate.value + '°';
});

/* ─────────────────────────────────────────────────────────────
   ANCLAR IMAGEN
   ───────────────────────────────────────────────────────────── */
DOM.btnAnchor.addEventListener('click', () => {
  if (!STATE.hasImage) return;
  STATE.anchored = true;
  STATE.anchorTx = STATE.tx;
  STATE.anchorTy = STATE.ty;
  STATE.deviceBasePitch = null; // re-calibrar desde posición actual
  requestOrientationPermission();
  DOM.btnAnchor.textContent = 'Re-anclar aquí';
  updateStatus('Anclada');
  DOM.statusLabel.className = 'anchored';
  // Feedback vibración
  if (navigator.vibrate) navigator.vibrate([30, 20, 30]);
});

/* ─────────────────────────────────────────────────────────────
   BLOQUEAR / DESBLOQUEAR
   ───────────────────────────────────────────────────────────── */
DOM.btnLock.addEventListener('click', () => {
  if (!STATE.hasImage) return;
  STATE.locked = !STATE.locked;
  setLockUI(STATE.locked);
  if (navigator.vibrate) navigator.vibrate(STATE.locked ? 60 : 20);
});

function setLockUI(locked) {
  DOM.lockOpen.style.display   = locked ? 'none'  : 'block';
  DOM.lockClosed.style.display = locked ? 'block' : 'none';
  DOM.btnLock.classList.toggle('locked', locked);
  if (locked) {
    updateStatus('Bloqueada');
    DOM.statusLabel.className = 'locked';
  } else if (STATE.anchored) {
    updateStatus('Anclada');
    DOM.statusLabel.className = 'anchored';
  } else {
    updateStatus(STATE.imageName ? STATE.imageName.substring(0,14) : 'Con imagen');
    DOM.statusLabel.className = '';
  }
}

/* ─────────────────────────────────────────────────────────────
   CUADRÍCULA
   ───────────────────────────────────────────────────────────── */
DOM.btnGrid.addEventListener('click', () => {
  STATE.gridVisible = !STATE.gridVisible;
  DOM.btnGrid.classList.toggle('active', STATE.gridVisible);
  if (STATE.gridVisible) {
    DOM.gridCanvas.classList.add('visible');
    drawGrid();
  } else {
    DOM.gridCanvas.classList.remove('visible');
  }
});

function drawGrid() {
  const gc = DOM.gridCanvas.getContext('2d');
  gc.clearRect(0, 0, W, H);
  const step = Math.min(W, H) / 12; // ~12 celdas en el lado menor
  gc.strokeStyle = 'rgba(0, 229, 160, 0.18)';
  gc.lineWidth = 0.8;

  // Líneas verticales
  for (let x = 0; x < W; x += step) {
    gc.beginPath(); gc.moveTo(x, 0); gc.lineTo(x, H); gc.stroke();
  }
  // Líneas horizontales
  for (let y = 0; y < H; y += step) {
    gc.beginPath(); gc.moveTo(0, y); gc.lineTo(W, y); gc.stroke();
  }

  // Líneas de tercios (regla de los tercios) en verde más brillante
  gc.strokeStyle = 'rgba(0, 229, 160, 0.35)';
  gc.lineWidth = 1;
  [W/3, 2*W/3].forEach(x => { gc.beginPath(); gc.moveTo(x,0); gc.lineTo(x,H); gc.stroke(); });
  [H/3, 2*H/3].forEach(y => { gc.beginPath(); gc.moveTo(0,y); gc.lineTo(W,y); gc.stroke(); });
}

/* ─────────────────────────────────────────────────────────────
   CARGAR IMAGEN — botón y file input
   ───────────────────────────────────────────────────────────── */
DOM.btnUpload.addEventListener('click', () => DOM.fileInput.click());
DOM.fileInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) loadImage(file);
  DOM.fileInput.value = '';
});

/* ─────────────────────────────────────────────────────────────
   RESTABLECER
   ───────────────────────────────────────────────────────────── */
DOM.btnReset.addEventListener('click', () => {
  STATE.tx       = W / 2;
  STATE.ty       = H / 2;
  STATE.scale    = 1.0;
  STATE.rotation = 0;
  STATE.opacity  = 0.85;
  STATE.anchored = false;
  STATE.locked   = false;
  STATE.deviceBasePitch = null;
  DOM.sliderOpacity.value = 85;  DOM.valOpacity.textContent = '85%';
  DOM.sliderScale.value   = 100; DOM.valScale.textContent   = '100%';
  DOM.sliderRotate.value  = 0;   DOM.valRotate.textContent  = '0°';
  DOM.btnAnchor.textContent = 'Anclar aquí';
  setLockUI(false);
  DOM.statusLabel.className = '';
  updateStatus(STATE.imageName || 'Sin imagen');
});

/* ─────────────────────────────────────────────────────────────
   UTILIDADES UI
   ───────────────────────────────────────────────────────────── */
function updateStatus(text) {
  DOM.statusLabel.textContent = text;
}

function showError(title, msg) {
  DOM.modalTitle.textContent = title;
  DOM.modalMsg.textContent   = msg;
  DOM.modalError.classList.remove('hidden');
}

DOM.modalClose.addEventListener('click', () => {
  DOM.modalError.classList.add('hidden');
  // Reintentar si no inició
  if (!STATE.started) startCamera();
});

/* ─────────────────────────────────────────────────────────────
   SPLASH — INICIO
   ───────────────────────────────────────────────────────────── */
DOM.btnStart.addEventListener('click', () => {
  // Verificar HTTPS o localhost
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    showError(
      'Requiere HTTPS',
      'La cámara solo funciona sobre HTTPS o localhost.\n\nUsa Ngrok, Netlify o GitHub Pages para publicar.',
    );
    return;
  }
  startCamera();
});

/* ─────────────────────────────────────────────────────────────
   SOPORTE WEBXR (opcional, si el dispositivo lo soporta)
   Se activa automáticamente si ARCore está disponible.
   Si no, el modo cámara 2D ya funciona.
   ───────────────────────────────────────────────────────────── */
async function tryWebXR() {
  if (!navigator.xr) return false;
  const supported = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
  if (!supported) return false;
  // WebXR disponible — se podría activar modo inmersivo
  // Por ahora usamos el modo cámara que es más compatible con Samsung Galaxy Note 10+
  console.log('[ARCalca] WebXR AR soportado — usando modo cámara por mayor compatibilidad');
  return true;
}

/* ─────────────────────────────────────────────────────────────
   PREVENIR SCROLL / ZOOM NATIVO EN MÓVIL
   ───────────────────────────────────────────────────────────── */
document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
document.addEventListener('gesturestart', e => e.preventDefault(), { passive: false });
document.addEventListener('gesturechange', e => e.preventDefault(), { passive: false });

/* ─────────────────────────────────────────────────────────────
   INICIALIZACIÓN
   ───────────────────────────────────────────────────────────── */
(async () => {
  await tryWebXR(); // intentar WebXR (informativo)

  // Auto-inicio si ya hay permisos (reapertura de pestaña)
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const hasCam  = devices.some(d => d.kind === 'videoinput' && d.label);
    if (hasCam) {
      // Ya tenemos permiso, iniciamos directamente
      // (el usuario aún debe tocar el botón por UX)
    }
  } catch (_) {}
})();

/* ─────────────────────────────────────────────────────────────
   DRAG & DROP DE IMAGEN (desktop / prueba local)
   ───────────────────────────────────────────────────────────── */
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) loadImage(file);
});
