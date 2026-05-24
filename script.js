/* AR CALCA v3 — enfoque simplificado, máxima compatibilidad Android */
'use strict';

/* ── Estado ─────────────────────────────────────────────── */
const S = {
  img: null, hasImg: false,
  tx: 0, ty: 0, scale: 1, rot: 0, opa: 0.85,
  locked: false, anchored: false, gridOn: false,
  anchorTx: 0, anchorTy: 0, basePitch: null, baseRoll: null,
};

let W, H, ctx;

/* ── Init ───────────────────────────────────────────────── */
window.addEventListener('load', () => {
  const btnStart = document.getElementById('btn-start');
  btnStart.addEventListener('click', iniciar);
});

async function iniciar() {
  // Ocultar splash
  document.getElementById('splash').style.display = 'none';

  // Configurar canvas sobre el video
  const canvas = document.getElementById('ar-canvas');
  ctx = canvas.getContext('2d');

  function resize() {
    W = canvas.width  = document.getElementById('grid-canvas').width  = window.innerWidth;
    H = canvas.height = document.getElementById('grid-canvas').height = window.innerHeight;
    if (!S.anchored) { S.tx = W/2; S.ty = H/2; }
  }
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 400));

  // Cámara
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { exact: 'environment' } }, audio: false
    });
    document.getElementById('camera-feed').srcObject = stream;
    await document.getElementById('camera-feed').play();
  } catch {
    try {
      const s2 = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      document.getElementById('camera-feed').srcObject = s2;
      await document.getElementById('camera-feed').play();
    } catch(e) {
      alert('No se pudo abrir la cámara: ' + e.message);
      return;
    }
  }

  // Orientación
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission !== 'function') {
    window.addEventListener('deviceorientation', onOrient, true);
  }

  // Botón subir imagen
  document.getElementById('btn-upload').addEventListener('click', abrirSelector);

  // Sliders
  document.getElementById('slider-opacity').addEventListener('input', function(){ S.opa = this.value/100; document.getElementById('val-opacity').textContent = this.value+'%'; });
  document.getElementById('slider-scale').addEventListener('input', function(){ S.scale = this.value/100; document.getElementById('val-scale').textContent = this.value+'%'; });
  document.getElementById('slider-rotate').addEventListener('input', function(){ S.rot = this.value * Math.PI/180; document.getElementById('val-rotate').textContent = this.value+'°'; });

  // Botones
  document.getElementById('btn-anchor').addEventListener('click', anclar);
  document.getElementById('btn-reset').addEventListener('click', resetear);
  document.getElementById('btn-lock').addEventListener('click', toggleLock);
  document.getElementById('btn-grid').addEventListener('click', toggleGrid);

  // Gestos
  initTouch();

  // Loop
  loop();
}

/* ── Render ─────────────────────────────────────────────── */
function loop() {
  requestAnimationFrame(loop);
  ctx.clearRect(0, 0, W, H);
  if (!S.hasImg || !S.img) return;

  // Calcular tamaño
  const maxW = W * 0.8, maxH = H * 0.7;
  const r = Math.min(maxW / S.img.naturalWidth, maxH / S.img.naturalHeight);
  const dw = S.img.naturalWidth  * r * S.scale;
  const dh = S.img.naturalHeight * r * S.scale;

  ctx.save();
  ctx.globalAlpha = S.opa;
  ctx.translate(S.tx, S.ty);
  ctx.rotate(S.rot);

  // Dibujar imagen
  ctx.drawImage(S.img, -dw/2, -dh/2, dw, dh);

  // Borde si no está bloqueada
  if (!S.locked) {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#00e5a0';
    ctx.lineWidth = 2;
    ctx.setLineDash([8,5]);
    ctx.strokeRect(-dw/2, -dh/2, dw, dh);
    ctx.setLineDash([]);
  }
  ctx.restore();
}

/* ── Selector de imagen ─────────────────────────────────── */
function abrirSelector() {
  // Crear input nuevo cada vez (fix Android)
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
  document.body.appendChild(inp);

  inp.addEventListener('change', function() {
    const file = this.files[0];
    if (!file) { document.body.removeChild(inp); return; }
    cargarImagen(file);
    document.body.removeChild(inp);
  });

  // Necesario en algunos Android: pequeño delay antes de click
  setTimeout(() => inp.click(), 100);
}

function cargarImagen(file) {
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      S.img    = img;
      S.hasImg = true;
      S.tx = W/2; S.ty = H/2;
      S.scale = 1; S.rot = 0; S.opa = 0.85;
      S.locked = false; S.anchored = false; S.basePitch = null;
      // Reset sliders
      document.getElementById('slider-opacity').value = 85; document.getElementById('val-opacity').textContent = '85%';
      document.getElementById('slider-scale').value   = 100; document.getElementById('val-scale').textContent  = '100%';
      document.getElementById('slider-rotate').value  = 0;   document.getElementById('val-rotate').textContent = '0°';
      // Mostrar controles
      document.getElementById('controls-panel').classList.remove('hidden');
      document.getElementById('touch-hint').classList.remove('hidden');
      setTimeout(() => document.getElementById('touch-hint').classList.add('hidden'), 4000);
      document.getElementById('crosshair').style.display = 'none';
      document.getElementById('status-label').textContent = file.name.substring(0,16);
      document.getElementById('status-label').className = '';
      document.getElementById('btn-anchor').textContent = 'Anclar aquí';
      setLockUI(false);
    };
    img.onerror = () => alert('No se pudo cargar la imagen. Usa PNG o JPG.');
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

/* ── Orientación ────────────────────────────────────────── */
function onOrient(e) {
  if (!S.anchored || S.locked) return;
  const b = e.beta||0, g = e.gamma||0;
  if (S.basePitch === null) { S.basePitch = b; S.baseRoll = g; }
  S.tx = S.anchorTx - (g - S.baseRoll)  * 0.35 * (W/100);
  S.ty = S.anchorTy - (b - S.basePitch) * 0.35 * (H/100);
}

/* ── Anclar ─────────────────────────────────────────────── */
function anclar() {
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

/* ── Lock ───────────────────────────────────────────────── */
function toggleLock() {
  if (!S.hasImg) return;
  S.locked = !S.locked;
  setLockUI(S.locked);
  if (navigator.vibrate) navigator.vibrate(S.locked ? 60 : 20);
}
function setLockUI(locked) {
  document.getElementById('lock-icon-open').style.display   = locked ? 'none'  : 'block';
  document.getElementById('lock-icon-closed').style.display = locked ? 'block' : 'none';
  document.getElementById('btn-lock').classList.toggle('locked', locked);
  if (locked) { document.getElementById('status-label').textContent='BLOQUEADA'; document.getElementById('status-label').className='locked'; }
  else if (S.anchored) { document.getElementById('status-label').textContent='ANCLADA'; document.getElementById('status-label').className='anchored'; }
}

/* ── Grid ───────────────────────────────────────────────── */
function toggleGrid() {
  S.gridOn = !S.gridOn;
  document.getElementById('btn-grid').classList.toggle('active', S.gridOn);
  const gc = document.getElementById('grid-canvas');
  gc.classList.toggle('visible', S.gridOn);
  if (S.gridOn) {
    const g = gc.getContext('2d');
    g.clearRect(0,0,W,H);
    const step = Math.min(W,H)/12;
    g.strokeStyle='rgba(0,229,160,0.15)'; g.lineWidth=0.8;
    for(let x=0;x<W;x+=step){g.beginPath();g.moveTo(x,0);g.lineTo(x,H);g.stroke();}
    for(let y=0;y<H;y+=step){g.beginPath();g.moveTo(0,y);g.lineTo(W,y);g.stroke();}
    g.strokeStyle='rgba(0,229,160,0.4)'; g.lineWidth=1;
    [W/3,2*W/3].forEach(x=>{g.beginPath();g.moveTo(x,0);g.lineTo(x,H);g.stroke();});
    [H/3,2*H/3].forEach(y=>{g.beginPath();g.moveTo(0,y);g.lineTo(W,y);g.stroke();});
  } else {
    document.getElementById('grid-canvas').getContext('2d').clearRect(0,0,W,H);
  }
}

/* ── Reset ──────────────────────────────────────────────── */
function resetear() {
  S.tx=W/2;S.ty=H/2;S.scale=1;S.rot=0;S.opa=0.85;
  S.locked=false;S.anchored=false;S.basePitch=null;
  document.getElementById('slider-opacity').value=85; document.getElementById('val-opacity').textContent='85%';
  document.getElementById('slider-scale').value=100;  document.getElementById('val-scale').textContent='100%';
  document.getElementById('slider-rotate').value=0;   document.getElementById('val-rotate').textContent='0°';
  document.getElementById('btn-anchor').textContent='Anclar aquí';
  setLockUI(false); document.getElementById('status-label').className='';
}

/* ── Touch ──────────────────────────────────────────────── */
function initTouch() {
  let t = { active:false, x:0, y:0, tx:0, ty:0, d:0, a:0, ps:1, pr:0 };
  const dist  = ts => Math.hypot(ts[0].clientX-ts[1].clientX, ts[0].clientY-ts[1].clientY);
  const angle = ts => Math.atan2(ts[1].clientY-ts[0].clientY, ts[1].clientX-ts[0].clientX);

  document.addEventListener('touchstart', e => {
    if (!S.hasImg || S.locked) return;
    if (e.target.closest('#top-bar,#controls-panel')) return;
    t.active = true;
    if (e.touches.length===1) { t.x=e.touches[0].clientX; t.y=e.touches[0].clientY; t.tx=S.tx; t.ty=S.ty; }
    else if (e.touches.length===2) { t.d=dist(e.touches); t.a=angle(e.touches); t.ps=S.scale; t.pr=S.rot; }
  },{passive:true});

  document.addEventListener('touchmove', e => {
    if (!S.hasImg || S.locked || !t.active) return;
    if (e.target.closest('#top-bar,#controls-panel')) return;
    e.preventDefault();
    if (e.touches.length===1) {
      S.tx = t.tx + (e.touches[0].clientX - t.x);
      S.ty = t.ty + (e.touches[0].clientY - t.y);
      if (S.anchored) { S.anchorTx=S.tx; S.anchorTy=S.ty; S.basePitch=null; }
    } else if (e.touches.length===2) {
      S.scale = Math.max(0.05, Math.min(8, t.ps * dist(e.touches)/t.d));
      S.rot   = t.pr + angle(e.touches) - t.a;
      document.getElementById('slider-scale').value = Math.round(S.scale*100);
      document.getElementById('val-scale').textContent = Math.round(S.scale*100)+'%';
    }
  },{passive:false});

  document.addEventListener('touchend', e => { if(e.touches.length===0) t.active=false; },{passive:true});
}

/* ── Drag & drop desktop ────────────────────────────────── */
document.addEventListener('dragover', e=>e.preventDefault());
document.addEventListener('drop', e=>{ e.preventDefault(); const f=e.dataTransfer.files[0]; if(f?.type.startsWith('image/')) cargarImagen(f); });
