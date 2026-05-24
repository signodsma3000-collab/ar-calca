/* ═══════════════════════════════════════════════════════════════
   AR CALCA v4 — WebXR + ARCore + fallback giroscopio
   Samsung Galaxy Note 10+ compatible
   ═══════════════════════════════════════════════════════════════ */
'use strict';

/* ── Modo de operación ──────────────────────────────────── */
let MODE = 'loading'; // 'webxr' | 'gyro' | 'loading'

/* ── Estado global ──────────────────────────────────────── */
const S = {
  img: null, hasImg: false,
  locked: false, anchored: false, gridOn: false,
  scale: 1, rot: 0, opa: 0.85,
  // Modo gyro
  tx: 0, ty: 0, anchorTx: 0, anchorTy: 0,
  basePitch: null, baseRoll: null,
};

/* ── Three.js (WebXR) ───────────────────────────────────── */
let renderer, scene, camera, xrSession, hitTestSource;
let imageMesh = null, imageTexture = null;
let reticle, reticleMatrix = new THREE.Matrix4();
let placedAt = null; // THREE.Matrix4 donde se ancló

/* ── Canvas 2D (fallback gyro) ──────────────────────────── */
let ctx2d, W, H;

/* ══════════════════════════════════════════════════════════
   INICIO
   ══════════════════════════════════════════════════════════ */
window.addEventListener('load', async () => {
  const xrStatus = document.getElementById('xr-status');

  // Verificar soporte WebXR AR
  if (navigator.xr) {
    try {
      const supported = await navigator.xr.isSessionSupported('immersive-ar');
      if (supported) {
        xrStatus.textContent = '✓ ARCore disponible';
        xrStatus.style.color = '#00e5a0';
        document.getElementById('btn-start').addEventListener('click', iniciarWebXR);
        return;
      }
    } catch(e) {}
  }

  // Fallback: modo giroscopio
  xrStatus.textContent = 'Modo estabilización por giroscopio';
  xrStatus.style.color = '#ff6b35';
  document.getElementById('btn-start').addEventListener('click', iniciarGyro);
});

/* ══════════════════════════════════════════════════════════
   MODO WebXR (ARCore — tracking real de superficies)
   ══════════════════════════════════════════════════════════ */
async function iniciarWebXR() {
  document.getElementById('splash').style.display = 'none';
  MODE = 'webxr';

  // Configurar Three.js renderer con WebXR
  renderer = new THREE.WebGLRenderer({
    canvas: document.getElementById('webxr-canvas'),
    alpha: true,
    antialias: true,
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;

  // Mostrar canvas WebXR
  document.getElementById('webxr-canvas').style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;z-index:1;';

  scene  = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

  // Luz ambiental
  scene.add(new THREE.AmbientLight(0xffffff, 1));

  // Retícula (anillo en el suelo)
  const retGeo = new THREE.RingGeometry(0.08, 0.12, 32);
  retGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  reticle = new THREE.Mesh(retGeo, new THREE.MeshBasicMaterial({ color: 0x00e5a0, side: THREE.DoubleSide }));
  reticle.visible = false;
  scene.add(reticle);

  // Iniciar sesión AR
  try {
    xrSession = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: document.getElementById('ui-overlay') },
    });
  } catch(e) {
    // Si falla hit-test, intentar sin él
    try {
      xrSession = await navigator.xr.requestSession('immersive-ar', {
        optionalFeatures: ['dom-overlay'],
        domOverlay: { root: document.getElementById('ui-overlay') },
      });
    } catch(e2) {
      mostrarError('WebXR falló', e2.message + '\n\nCambiando a modo giroscopio...');
      setTimeout(iniciarGyro, 1500);
      return;
    }
  }

  renderer.xr.setReferenceSpaceType('local');
  await renderer.xr.setSession(xrSession);

  // Hit test source
  try {
    const refSpace = await xrSession.requestReferenceSpace('viewer');
    hitTestSource = await xrSession.requestHitTestSource({ space: refSpace });
  } catch(e) {
    hitTestSource = null; // continúa sin hit-test
  }

  // UI para WebXR
  setupUIWebXR();

  // Loop de render
  renderer.setAnimationLoop(xrRenderLoop);

  xrSession.addEventListener('end', () => {
    MODE = 'gyro';
    iniciarGyro();
  });
}

function xrRenderLoop(timestamp, frame) {
  if (!frame) return;

  // Hit test — mover retícula al suelo
  if (hitTestSource && !S.anchored) {
    const hits = frame.getHitTestResults(hitTestSource);
    if (hits.length > 0) {
      const pose = hits[0].getPose(renderer.xr.getReferenceSpace());
      reticleMatrix.fromArray(pose.transform.matrix);
      reticle.matrix.copy(reticleMatrix);
      reticle.matrix.decompose(reticle.position, reticle.quaternion, reticle.scale);
      reticle.visible = true;
      document.getElementById('reticle-hint').classList.remove('hidden');
    } else {
      reticle.visible = false;
    }
  }

  // Mantener imagen en posición anclada
  if (imageMesh && S.anchored && placedAt) {
    imageMesh.matrix.copy(placedAt);
    imageMesh.matrix.decompose(imageMesh.position, imageMesh.quaternion, imageMesh.scale);
  }

  renderer.render(scene, camera);
}

function colocarImagenWebXR() {
  if (!S.hasImg || !reticle.visible) return;

  // Crear plano con la imagen
  if (imageMesh) scene.remove(imageMesh);

  const aspect = S.img.naturalWidth / S.img.naturalHeight;
  const geo = new THREE.PlaneGeometry(0.3 * aspect, 0.3);
  geo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));

  imageTexture = new THREE.Texture(S.img);
  imageTexture.needsUpdate = true;

  const mat = new THREE.MeshBasicMaterial({
    map: imageTexture,
    transparent: true,
    opacity: S.opa,
    side: THREE.DoubleSide,
  });

  imageMesh = new THREE.Mesh(geo, mat);
  imageMesh.matrixAutoUpdate = false;

  // Posicionar en retícula (suelo detectado)
  placedAt = reticleMatrix.clone();
  imageMesh.matrix.copy(placedAt);
  imageMesh.matrix.decompose(imageMesh.position, imageMesh.quaternion, imageMesh.scale);

  scene.add(imageMesh);
  S.anchored = true;
  reticle.visible = false;

  document.getElementById('reticle-hint').classList.add('hidden');
  document.getElementById('status-label').textContent = 'ANCLADA';
  document.getElementById('status-label').className = 'anchored';
  document.getElementById('btn-anchor').textContent = 'Re-anclar';
  if (navigator.vibrate) navigator.vibrate([30,20,30]);
}

/* ══════════════════════════════════════════════════════════
   MODO GYRO (fallback sin ARCore)
   ══════════════════════════════════════════════════════════ */
async function iniciarGyro() {
  document.getElementById('splash').style.display = 'none';
  document.getElementById('webxr-canvas').style.display = 'none';
  MODE = 'gyro';

  // Canvas 2D
  const canvas = document.getElementById('ar-canvas');
  ctx2d = canvas.getContext('2d');

  function resize() {
    W = canvas.width = document.getElementById('grid-canvas').width = window.innerWidth;
    H = canvas.height = document.getElementById('grid-canvas').height = window.innerHeight;
    if (!S.anchored) { S.tx = W/2; S.ty = H/2; }
  }
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 400));

  // Cámara
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { exact: 'environment' } }, audio: false,
    });
    document.getElementById('camera-feed').srcObject = stream;
    await document.getElementById('camera-feed').play();
  } catch {
    try {
      const s2 = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      document.getElementById('camera-feed').srcObject = s2;
      await document.getElementById('camera-feed').play();
    } catch(e) {
      mostrarError('Sin cámara', e.message); return;
    }
  }

  // Giroscopio
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission !== 'function') {
    window.addEventListener('deviceorientation', onOrient, true);
  }

  S.tx = window.innerWidth/2;
  S.ty = window.innerHeight/2;

  setupUIGyro();
  gyroLoop();
}

function gyroLoop() {
  requestAnimationFrame(gyroLoop);
  ctx2d.clearRect(0, 0, W, H);
  if (!S.hasImg || !S.img) return;

  const maxW = W*0.8, maxH = H*0.7;
  const r = Math.min(maxW/S.img.naturalWidth, maxH/S.img.naturalHeight);
  const dw = S.img.naturalWidth  * r * S.scale;
  const dh = S.img.naturalHeight * r * S.scale;

  ctx2d.save();
  ctx2d.globalAlpha = S.opa;
  ctx2d.translate(S.tx, S.ty);
  ctx2d.rotate(S.rot);
  ctx2d.drawImage(S.img, -dw/2, -dh/2, dw, dh);

  if (!S.locked) {
    ctx2d.globalAlpha = 1;
    ctx2d.strokeStyle = '#00e5a0';
    ctx2d.lineWidth = 2;
    ctx2d.setLineDash([8,5]);
    ctx2d.strokeRect(-dw/2, -dh/2, dw, dh);
    ctx2d.setLineDash([]);
  }
  ctx2d.restore();
}

function onOrient(e) {
  if (!S.anchored || S.locked || MODE !== 'gyro') return;
  const b = e.beta||0, g = e.gamma||0;
  if (S.basePitch === null) { S.basePitch = b; S.baseRoll = g; }
  S.tx = S.anchorTx - (g - S.baseRoll)  * 0.4 * (W/100);
  S.ty = S.anchorTy - (b - S.basePitch) * 0.4 * (H/100);
}

/* ══════════════════════════════════════════════════════════
   UI COMPARTIDA
   ══════════════════════════════════════════════════════════ */
function setupUIWebXR() {
  setupBtnUpload();
  setupSliders();
  setupBtnGrid();
  setupBtnLock();
  setupBtnReset();
  initTouch();

  // En WebXR: tocar pantalla = anclar imagen en retícula
  document.getElementById('btn-anchor').addEventListener('click', () => {
    if (MODE === 'webxr') colocarImagenWebXR();
    else anclarGyro();
  });

  // Toque en el área AR también ancla
  document.getElementById('webxr-canvas').addEventListener('click', () => {
    if (S.hasImg && !S.anchored) colocarImagenWebXR();
  });

  // Mostrar hint de retícula si hay imagen
  updateReticleHint();
}

function setupUIGyro() {
  setupBtnUpload();
  setupSliders();
  setupBtnGrid();
  setupBtnLock();
  setupBtnReset();
  initTouch();

  document.getElementById('btn-anchor').addEventListener('click', anclarGyro);
}

function anclarGyro() {
  if (!S.hasImg) return;
  S.anchored = true; S.anchorTx = S.tx; S.anchorTy = S.ty; S.basePitch = null;
  if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission().then(r => {
      if (r==='granted') window.addEventListener('deviceorientation', onOrient, true);
    }).catch(()=>{});
  }
  document.getElementById('btn-anchor').textContent = 'Re-anclar aquí';
  document.getElementById('status-label').textContent = 'ANCLADA';
  document.getElementById('status-label').className = 'anchored';
  if (navigator.vibrate) navigator.vibrate([30,20,30]);
}

function updateReticleHint() {
  if (S.hasImg && !S.anchored && MODE === 'webxr') {
    document.getElementById('reticle-hint').classList.remove('hidden');
  }
}

/* ── Botón subir imagen ─────────────────────────────────── */
function setupBtnUpload() {
  document.getElementById('btn-upload').addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.style.cssText = 'position:fixed;top:-9999px;opacity:0;';
    document.body.appendChild(inp);
    inp.addEventListener('change', function() {
      if (this.files[0]) cargarImagen(this.files[0]);
      document.body.removeChild(inp);
    });
    setTimeout(() => inp.click(), 100);
  });
}

function cargarImagen(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      S.img = img; S.hasImg = true;
      S.scale = 1; S.rot = 0; S.opa = 0.85;
      S.locked = false; S.anchored = false; S.basePitch = null;
      placedAt = null;

      // Reset sliders
      document.getElementById('slider-opacity').value = 85; document.getElementById('val-opacity').textContent='85%';
      document.getElementById('slider-scale').value   = 100; document.getElementById('val-scale').textContent='100%';
      document.getElementById('slider-rotate').value  = 0;   document.getElementById('val-rotate').textContent='0°';

      // Mostrar controles
      document.getElementById('controls-panel').classList.remove('hidden');
      document.getElementById('touch-hint').classList.remove('hidden');
      document.getElementById('crosshair').style.display = 'none';
      setTimeout(() => document.getElementById('touch-hint').classList.add('hidden'), 4000);

      document.getElementById('status-label').textContent = file.name.substring(0,16);
      document.getElementById('status-label').className = '';
      document.getElementById('btn-anchor').textContent = MODE==='webxr' ? 'Tocar suelo para anclar' : 'Anclar aquí';
      setLockUI(false);

      // WebXR: actualizar textura si ya hay mesh
      if (MODE === 'webxr') {
        if (imageMesh) { scene.remove(imageMesh); imageMesh = null; }
        S.anchored = false;
        placedAt = null;
        document.getElementById('reticle-hint').classList.remove('hidden');
        reticle.visible = true;
      } else {
        // Gyro: centrar
        S.tx = W/2; S.ty = H/2;
        S.anchorTx = W/2; S.anchorTy = H/2;
      }
    };
    img.onerror = () => mostrarError('Error', 'No se pudo cargar la imagen.');
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

/* ── Sliders ────────────────────────────────────────────── */
function setupSliders() {
  document.getElementById('slider-opacity').addEventListener('input', function() {
    S.opa = this.value/100;
    document.getElementById('val-opacity').textContent = this.value+'%';
    if (imageMesh) imageMesh.material.opacity = S.opa;
  });
  document.getElementById('slider-scale').addEventListener('input', function() {
    S.scale = this.value/100;
    document.getElementById('val-scale').textContent = this.value+'%';
    if (imageMesh) imageMesh.scale.setScalar(S.scale);
  });
  document.getElementById('slider-rotate').addEventListener('input', function() {
    S.rot = this.value * Math.PI/180;
    document.getElementById('val-rotate').textContent = this.value+'°';
    if (imageMesh) imageMesh.rotation.y = S.rot;
  });
}

/* ── Lock ───────────────────────────────────────────────── */
function setupBtnLock() {
  document.getElementById('btn-lock').addEventListener('click', () => {
    if (!S.hasImg) return;
    S.locked = !S.locked;
    setLockUI(S.locked);
    if (navigator.vibrate) navigator.vibrate(S.locked ? 60 : 20);
  });
}
function setLockUI(locked) {
  document.getElementById('lock-icon-open').style.display   = locked ? 'none'  : 'block';
  document.getElementById('lock-icon-closed').style.display = locked ? 'block' : 'none';
  document.getElementById('btn-lock').classList.toggle('locked', locked);
  if (locked) {
    document.getElementById('status-label').textContent = 'BLOQUEADA';
    document.getElementById('status-label').className = 'locked';
  } else if (S.anchored) {
    document.getElementById('status-label').textContent = 'ANCLADA';
    document.getElementById('status-label').className = 'anchored';
  }
}

/* ── Grid ───────────────────────────────────────────────── */
function setupBtnGrid() {
  document.getElementById('btn-grid').addEventListener('click', () => {
    S.gridOn = !S.gridOn;
    document.getElementById('btn-grid').classList.toggle('active', S.gridOn);
    const gc = document.getElementById('grid-canvas');
    gc.classList.toggle('visible', S.gridOn);
    if (S.gridOn) dibujarGrid();
    else gc.getContext('2d').clearRect(0,0,W||window.innerWidth,H||window.innerHeight);
  });
}
function dibujarGrid() {
  const gc = document.getElementById('grid-canvas');
  const g = gc.getContext('2d');
  const w = gc.width, h = gc.height;
  g.clearRect(0,0,w,h);
  const step = Math.min(w,h)/12;
  g.strokeStyle='rgba(0,229,160,0.15)'; g.lineWidth=0.8;
  for(let x=0;x<w;x+=step){g.beginPath();g.moveTo(x,0);g.lineTo(x,h);g.stroke();}
  for(let y=0;y<h;y+=step){g.beginPath();g.moveTo(0,y);g.lineTo(w,y);g.stroke();}
  g.strokeStyle='rgba(0,229,160,0.4)'; g.lineWidth=1;
  [w/3,2*w/3].forEach(x=>{g.beginPath();g.moveTo(x,0);g.lineTo(x,h);g.stroke();});
  [h/3,2*h/3].forEach(y=>{g.beginPath();g.moveTo(0,y);g.lineTo(w,y);g.stroke();});
}

/* ── Reset ──────────────────────────────────────────────── */
function setupBtnReset() {
  document.getElementById('btn-reset').addEventListener('click', () => {
    S.scale=1; S.rot=0; S.opa=0.85; S.locked=false; S.anchored=false; S.basePitch=null;
    if (MODE==='gyro') { S.tx=W/2; S.ty=H/2; }
    if (imageMesh) { imageMesh.scale.setScalar(1); imageMesh.rotation.y=0; imageMesh.material.opacity=0.85; }
    document.getElementById('slider-opacity').value=85; document.getElementById('val-opacity').textContent='85%';
    document.getElementById('slider-scale').value=100;  document.getElementById('val-scale').textContent='100%';
    document.getElementById('slider-rotate').value=0;   document.getElementById('val-rotate').textContent='0°';
    document.getElementById('btn-anchor').textContent = MODE==='webxr' ? 'Tocar suelo para anclar' : 'Anclar aquí';
    setLockUI(false); document.getElementById('status-label').className='';
  });
}

/* ── Touch gestos ───────────────────────────────────────── */
function initTouch() {
  let t = { active:false, x:0, y:0, tx:0, ty:0, d:0, a:0, ps:1, pr:0 };
  const dist  = ts => Math.hypot(ts[0].clientX-ts[1].clientX, ts[0].clientY-ts[1].clientY);
  const angle = ts => Math.atan2(ts[1].clientY-ts[0].clientY, ts[1].clientX-ts[0].clientX);

  document.addEventListener('touchstart', e => {
    if (!S.hasImg || S.locked) return;
    if (e.target.closest('#top-bar,#controls-panel')) return;
    t.active = true;
    if (e.touches.length===1) {
      t.x=e.touches[0].clientX; t.y=e.touches[0].clientY;
      t.tx=S.tx; t.ty=S.ty;
    } else if (e.touches.length===2) {
      t.d=dist(e.touches); t.a=angle(e.touches);
      t.ps=S.scale; t.pr=S.rot;
    }
  },{passive:true});

  document.addEventListener('touchmove', e => {
    if (!S.hasImg || S.locked || !t.active) return;
    if (e.target.closest('#top-bar,#controls-panel')) return;
    e.preventDefault();
    if (e.touches.length===1 && MODE==='gyro') {
      S.tx = t.tx + (e.touches[0].clientX - t.x);
      S.ty = t.ty + (e.touches[0].clientY - t.y);
      if (S.anchored) { S.anchorTx=S.tx; S.anchorTy=S.ty; S.basePitch=null; }
    } else if (e.touches.length===2) {
      const newScale = Math.max(0.05, Math.min(8, t.ps * dist(e.touches)/t.d));
      const newRot   = t.pr + angle(e.touches) - t.a;
      S.scale = newScale; S.rot = newRot;
      if (imageMesh) { imageMesh.scale.setScalar(newScale); imageMesh.rotation.y = newRot; }
      document.getElementById('slider-scale').value = Math.round(newScale*100);
      document.getElementById('val-scale').textContent = Math.round(newScale*100)+'%';
    }
  },{passive:false});

  document.addEventListener('touchend', e => { if(e.touches.length===0) t.active=false; },{passive:true});
}

/* ── Error modal ────────────────────────────────────────── */
function mostrarError(t, m) {
  document.getElementById('modal-title').textContent=t;
  document.getElementById('modal-msg').textContent=m;
  document.getElementById('modal-error').classList.remove('hidden');
}
document.getElementById('modal-close').addEventListener('click', () => {
  document.getElementById('modal-error').classList.add('hidden');
});

/* ── Drag & drop desktop ────────────────────────────────── */
document.addEventListener('dragover', e=>e.preventDefault());
document.addEventListener('drop', e=>{ e.preventDefault(); const f=e.dataTransfer.files[0]; if(f?.type.startsWith('image/')) cargarImagen(f); });
