/* ═══════════════════════════════════════════════════════════════
   AR CALCA — script.js  (v2 — fix carga de imagen móvil)
   ═══════════════════════════════════════════════════════════════ */
'use strict';

/* ── Estado global ─────────────────────────────────────── */
const STATE = {
  started: false, hasImage: false, locked: false,
  anchored: false, gridVisible: false,
  imageLoaded: null, imageName: '',
  tx: 0, ty: 0, scale: 1.0, rotation: 0, opacity: 0.85,
  anchorTx: 0, anchorTy: 0,
  deviceBasePitch: null, deviceBaseRoll: null,
  pitchSensitivity: 0.35, rollSensitivity: 0.35,
};

/* ── DOM ────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const DOM = {
  splash:        $('splash'),
  btnStart:      $('btn-start'),
  camera:        $('camera-feed'),
  arCanvas:      $('ar-canvas'),
  gridCanvas:    $('grid-canvas'),
  statusLabel:   $('status-label'),
  btnUpload:     $('btn-upload'),
  btnGrid:       $('btn-grid'),
  btnLock:       $('btn-lock'),
  lockOpen:      $('lock-icon-open'),
  lockClosed:    $('lock-icon-closed'),
  controlsPanel: $('controls-panel'),
  sliderOpacity: $('slider-opacity'),
  valOpacity:    $('val-opacity'),
  sliderScale:   $('slider-scale'),
  valScale:      $('val-scale'),
  sliderRotate:  $('slider-rotate'),
  valRotate:     $('val-rotate'),
  btnReset:      $('btn-reset'),
  btnAnchor:     $('btn-anchor'),
  crosshair:     $('crosshair'),
  touchHint:     $('touch-hint'),
  fileInput:     $('file-input'),
  modalError:    $('modal-error'),
  modalTitle:    $('modal-title'),
  modalMsg:      $('modal-msg'),
  modalClose:    $('modal-close'),
};

/* ── Canvas 2D ──────────────────────────────────────────── */
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
  if (!STATE.anchored) { STATE.tx = W / 2; STATE.ty = H / 2; }
  if (STATE.gridVisible) drawGrid();
}

/* ── Render loop ────────────────────────────────────────── */
function renderLoop() {
  requestAnimationFrame(renderLoop);
  ctx2d.clearRect(0, 0, W, H);
  if (STATE.hasImage && STATE.imageLoaded) drawARImage();
}

function drawARImage() {
  const img = STATE.imageLoaded;
  const maxW = W * 0.75, maxH = H * 0.65;
  const ratio = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
  const dw = img.naturalWidth  * ratio * STATE.scale;
  const dh = img.naturalHeight * ratio * STATE.scale;

  ctx2d.save();
  ctx2d.globalAlpha = STATE.opacity;
  ctx2d.translate(STATE.tx, STATE.ty);
  ctx2d.rotate(STATE.rotation);
  ctx2d.drawImage(img, -dw / 2, -dh / 2, dw, dh);

  if (!STATE.locked) {
    ctx2d.strokeStyle = 'rgba(0,229,160,0.5)';
    ctx2d.lineWidth = 1.5;
    ctx2d.setLineDash([6, 4]);
    ctx2d.strokeRect(-dw / 2, -dh / 2, dw, dh);
    ctx2d.setLineDash([]);
    const cs = 14;
    ctx2d.strokeStyle = 'rgba(0,229,160,1)';
    ctx2d.lineWidth = 2.5;
    [[-dw/2,-dh/2],[dw/2,-dh/2],[-dw/2,dh/2],[dw/2,dh/2]].forEach(([cx,cy]) => {
      ctx2d.beginPath();
      ctx2d.moveTo(cx + Math.sign(cx)*cs, cy);
      ctx2d.lineTo(cx, cy);
      ctx2d.lineTo(cx, cy + Math.sign(cy)*cs);
      ctx2d.stroke();
    });
  }
  ctx2d.restore();
}

/* ── Orientación (ancla giroscópica) ────────────────────── */
function initOrientation() {
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission !== 'function') {
    window.addEventListener('deviceorientation', onOrientation, true);
  }
}
function requestOrientationPermission() {
  if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission()
      .then(r => { if (r === 'granted') window.addEventListener('deviceorientation', onOrientation, true); })
      .catch(() => {});
  }
}
function onOrientation(e) {
  if (!STATE.anchored || STATE.locked) return;
  const beta = e.beta || 0, gamma = e.gamma || 0;
  if (STATE.deviceBasePitch === null) {
    STATE.deviceBasePitch = beta; STATE.deviceBaseRoll = gamma;
  }
  STATE.tx = STATE.anchorTx + -(gamma - STATE.deviceBaseRoll)  * STATE.rollSensitivity  * (W / 100);
  STATE.ty = STATE.anchorTy + -(beta  - STATE.deviceBasePitch) * STATE.pitchSensitivity * (H / 100);
}

/* ── Cámara ─────────────────────────────────────────────── */
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { exact: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    DOM.camera.srcObject = stream;
    await DOM.camera.play();
  } catch {
    try {
      const stream2 = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      DOM.camera.srcObject = stream2;
      await DOM.camera.play();
    } catch (err) {
      showError('Cámara no disponible', 'Abre esta página en Chrome Android con HTTPS.\n' + err.message);
      return;
    }
  }
  STATE.started = true;
  DOM.splash.style.display = 'none';
  initCanvas();
  initOrientation();
  renderLoop();
  updateStatus('Sin imagen');
}

/* ── Carga de imagen (CORREGIDO para móvil) ─────────────── */
function loadImage(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showError('Formato incorrecto', 'Usa archivos PNG, JPG o WEBP.');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      STATE.imageLoaded = img;
      STATE.imageName   = file.name;
      STATE.hasImage    = true;
      STATE.tx = W / 2; STATE.ty = H / 2;
      STATE.scale = 1.0; STATE.rotation = 0; STATE.opacity = 0.85;
      STATE.anchored = false; STATE.locked = false;
      STATE.deviceBasePitch = null;
      // Reset sliders
      DOM.sliderOpacity.value = 85;  DOM.valOpacity.textContent = '85%';
      DOM.sliderScale.value   = 100; DOM.valScale.textContent   = '100%';
      DOM.sliderRotate.value  = 0;   DOM.valRotate.textContent  = '0°';
      // UI
      DOM.controlsPanel.classList.remove('hidden');
      DOM.touchHint.classList.remove('hidden');
      setTimeout(() => DOM.touchHint.classList.add('hidden'), 5000);
      DOM.crosshair.style.display = 'none';
      setLockUI(false);
      const name = file.name.length > 14 ? file.name.substring(0,12)+'…' : file.name;
      updateStatus(name);
      DOM.statusLabel.className = '';
      DOM.btnAnchor.textContent = 'Anclar aquí';
    };
    img.onerror = () => showError('Error de imagen', 'No se pudo cargar la imagen.');
    img.src = e.target.result;
  };
  reader.onerror = () => showError('Error de lectura', 'No se pudo leer el archivo.');
  reader.readAsDataURL(file); // ← usa FileReader en vez de createObjectURL (más compatible en Android)
}

/* ── Botón subir imagen (CORREGIDO) ─────────────────────── */
DOM.btnUpload.addEventListener('click', () => {
  // Crear un input fresco cada vez (fix para Android Chrome)
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) loadImage(file);
    document.body.removeChild(input);
  });
  input.click();
});

// También mantener el input del HTML como fallback
DOM.fileInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) loadImage(file);
  DOM.fileInput.value = '';
});

/* ── Gestos táctiles ────────────────────────────────────── */
let touch = { active: false, startX: 0, startY: 0, startTx: 0, startTy: 0, prevDist: 0, prevAngle: 0, prevScale: 1, prevRot: 0 };
const getDist  = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
const getAngle = t => Math.atan2(t[1].clientY - t[0].clientY, t[1].clientX - t[0].clientX);

// El área de gestos es el body completo (más confiable en móvil)
document.body.addEventListener('touchstart', e => {
  if (!STATE.hasImage || STATE.locked) return;
  // Ignorar toques en botones UI
  if (e.target.closest('#top-bar, #controls-panel')) return;
  touch.active = true;
  if (e.touches.length === 1) {
    touch.startX = e.touches[0].clientX; touch.startY = e.touches[0].clientY;
    touch.startTx = STATE.tx; touch.startTy = STATE.ty;
  } else if (e.touches.length === 2) {
    touch.prevDist = getDist(e.touches); touch.prevAngle = getAngle(e.touches);
    touch.prevScale = STATE.scale; touch.prevRot = STATE.rotation;
  }
}, { passive: true });

document.body.addEventListener('touchmove', e => {
  if (!STATE.hasImage || STATE.locked || !touch.active) return;
  if (e.target.closest('#top-bar, #controls-panel')) return;
  e.preventDefault();
  if (e.touches.length === 1) {
    STATE.tx = touch.startTx + (e.touches[0].clientX - touch.startX);
    STATE.ty = touch.startTy + (e.touches[0].clientY - touch.startY);
    if (STATE.anchored) { STATE.anchorTx = STATE.tx; STATE.anchorTy = STATE.ty; STATE.deviceBasePitch = null; }
  } else if (e.touches.length === 2) {
    STATE.scale    = Math.max(0.05, Math.min(6, touch.prevScale * (getDist(e.touches) / touch.prevDist)));
    STATE.rotation = touch.prevRot + (getAngle(e.touches) - touch.prevAngle);
    DOM.sliderScale.value  = Math.round(STATE.scale * 100);
    DOM.valScale.textContent = DOM.sliderScale.value + '%';
    DOM.sliderRotate.value = Math.round(((STATE.rotation % (Math.PI*2)) + Math.PI*2) % (Math.PI*2) * 180 / Math.PI);
    DOM.valRotate.textContent = DOM.sliderRotate.value + '°';
  }
}, { passive: false });

document.body.addEventListener('touchend', e => {
  if (e.touches.length === 0) touch.active = false;
}, { passive: true });

/* ── Sliders ────────────────────────────────────────────── */
DOM.sliderOpacity.addEventListener('input', () => { STATE.opacity = DOM.sliderOpacity.value / 100; DOM.valOpacity.textContent = DOM.sliderOpacity.value + '%'; });
DOM.sliderScale.addEventListener('input',   () => { STATE.scale = DOM.sliderScale.value / 100; DOM.valScale.textContent = DOM.sliderScale.value + '%'; });
DOM.sliderRotate.addEventListener('input',  () => { STATE.rotation = DOM.sliderRotate.value * Math.PI / 180; DOM.valRotate.textContent = DOM.sliderRotate.value + '°'; });

/* ── Anclar ─────────────────────────────────────────────── */
DOM.btnAnchor.addEventListener('click', () => {
  if (!STATE.hasImage) return;
  STATE.anchored = true; STATE.anchorTx = STATE.tx; STATE.anchorTy = STATE.ty;
  STATE.deviceBasePitch = null;
  requestOrientationPermission();
  DOM.btnAnchor.textContent = 'Re-anclar aquí';
  DOM.statusLabel.textContent = 'ANCLADA'; DOM.statusLabel.className = 'anchored';
  if (navigator.vibrate) navigator.vibrate([30, 20, 30]);
});

/* ── Bloquear ───────────────────────────────────────────── */
DOM.btnLock.addEventListener('click', () => {
  if (!STATE.hasImage) return;
  STATE.locked = !STATE.locked;
  setLockUI(STATE.locked);
  if (navigator.vibrate) navigator.vibrate(STATE.locked ? 60 : 20);
});
function setLockUI(locked) {
  DOM.lockOpen.style.display   = locked ? 'none' : 'block';
  DOM.lockClosed.style.display = locked ? 'block' : 'none';
  DOM.btnLock.classList.toggle('locked', locked);
  if (locked) { DOM.statusLabel.textContent = 'BLOQUEADA'; DOM.statusLabel.className = 'locked'; }
  else if (STATE.anchored) { DOM.statusLabel.textContent = 'ANCLADA'; DOM.statusLabel.className = 'anchored'; }
  else { DOM.statusLabel.className = ''; }
}

/* ── Cuadrícula ─────────────────────────────────────────── */
DOM.btnGrid.addEventListener('click', () => {
  STATE.gridVisible = !STATE.gridVisible;
  DOM.btnGrid.classList.toggle('active', STATE.gridVisible);
  DOM.gridCanvas.classList.toggle('visible', STATE.gridVisible);
  if (STATE.gridVisible) drawGrid();
  else { const gc = DOM.gridCanvas.getContext('2d'); gc.clearRect(0,0,W,H); }
});
function drawGrid() {
  const gc = DOM.gridCanvas.getContext('2d');
  gc.clearRect(0, 0, W, H);
  const step = Math.min(W, H) / 12;
  gc.strokeStyle = 'rgba(0,229,160,0.15)'; gc.lineWidth = 0.8;
  for (let x = 0; x < W; x += step) { gc.beginPath(); gc.moveTo(x,0); gc.lineTo(x,H); gc.stroke(); }
  for (let y = 0; y < H; y += step) { gc.beginPath(); gc.moveTo(0,y); gc.lineTo(W,y); gc.stroke(); }
  gc.strokeStyle = 'rgba(0,229,160,0.35)'; gc.lineWidth = 1;
  [W/3,2*W/3].forEach(x => { gc.beginPath(); gc.moveTo(x,0); gc.lineTo(x,H); gc.stroke(); });
  [H/3,2*H/3].forEach(y => { gc.beginPath(); gc.moveTo(0,y); gc.lineTo(W,y); gc.stroke(); });
}

/* ── Restablecer ────────────────────────────────────────── */
DOM.btnReset.addEventListener('click', () => {
  STATE.tx=W/2; STATE.ty=H/2; STATE.scale=1; STATE.rotation=0; STATE.opacity=0.85;
  STATE.anchored=false; STATE.locked=false; STATE.deviceBasePitch=null;
  DOM.sliderOpacity.value=85; DOM.valOpacity.textContent='85%';
  DOM.sliderScale.value=100;  DOM.valScale.textContent='100%';
  DOM.sliderRotate.value=0;   DOM.valRotate.textContent='0°';
  DOM.btnAnchor.textContent='Anclar aquí';
  setLockUI(false); DOM.statusLabel.className='';
  updateStatus(STATE.imageName || 'Sin imagen');
});

/* ── UI helpers ─────────────────────────────────────────── */
function updateStatus(t) { DOM.statusLabel.textContent = t; }
function showError(title, msg) { DOM.modalTitle.textContent=title; DOM.modalMsg.textContent=msg; DOM.modalError.classList.remove('hidden'); }
DOM.modalClose.addEventListener('click', () => { DOM.modalError.classList.add('hidden'); if (!STATE.started) startCamera(); });

/* ── Splash ─────────────────────────────────────────────── */
DOM.btnStart.addEventListener('click', () => {
  if (location.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(location.hostname)) {
    showError('Requiere HTTPS', 'La cámara solo funciona sobre HTTPS.\nUsa la URL de GitHub Pages.'); return;
  }
  startCamera();
});

/* ── Drag & drop (desktop) ──────────────────────────────── */
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file?.type.startsWith('image/')) loadImage(file);
});

/* ── Prevenir zoom nativo ───────────────────────────────── */
document.addEventListener('touchmove', e => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });
