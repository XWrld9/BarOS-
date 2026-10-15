// ══════════════════════════════════════════════════════════════════════
//  BarOS HyperScan v9 — MOTEUR HYBRIDE ULTRA-HAUTE PERFORMANCE
//  Architecture : BarcodeDetector → ZXing WASM → jsQR Worker × 3 →
//                 jsQR MainThread → Pipeline Vision Adaptative
//  Fonctionnalités : Benchmark auto · Multi-résolution · Multi-angle ·
//  Autofocus dynamique · Torch intelligent · Anti-freeze · Recovery cam
//  Offline-first · Android 8-16 · PWA · WebWorkers · OffscreenCanvas
// ══════════════════════════════════════════════════════════════════════

// ── CONSTANTES & CONFIG ──────────────────────────────────────────────
const SB_URL_DEFAULT = 'https://fijmxmaupjsdyqgynrem.supabase.co';
const SB_KEY_DEFAULT = 'sb_publishable_B3NJtcctuVVbvE_S44oP9A_qiMHK1dd';

const COOLDOWN_MS       = 2200;
const AUTO_CLOSE_MS     = 61000;
const FREEZE_THRESHOLD  = 90;     // frames avant détection freeze (~3s @30fps)
const DECODE_INTERVAL   = 30;     // ms entre décodages jsQR (~33fps)
const QUALITY_CHECK_INT = 45;     // frames entre checks qualité image

// ── ÉTAT GLOBAL ──────────────────────────────────────────────────────
let db            = null;
let ETAB_ID       = null;
let ETAB_NOM      = '';
let scanCooldown  = false;
let resultTimer   = null;
let sharedStream  = null;

// ── ÉTAT SCANNER ─────────────────────────────────────────────────────
let _mainVideo      = null;
let _mainCanvas     = document.getElementById('qr-canvas');
let _mainCtx        = _mainCanvas.getContext('2d', { willReadFrequently: true });
let _torchOn        = false;
let _torchTrack     = null;
let _torchSupported = false;
let _scanPaused     = false;
let _mainAnimFrame  = null;
let _frozenCount    = 0;
let _lastFrameHash  = 0;
let _frameCount     = 0;
let _lastScanTs     = 0;
let _pageHideTs     = 0;
let _engineName     = 'jsQR';
let _autoTorchOn    = false;   // torch automatique basse lumière
let _lastLightLevel = 255;     // niveau luminosité estimé
let _zoomLevel      = 1;       // zoom natif actuel
let _focusOk        = false;   // autofocus verrouillé

// ── BENCHMARK MOTEUR ─────────────────────────────────────────────────
const _engineBenchmark = {
  barcodeDetector: { wins: 0, times: [], avgMs: 0 },
  zxing:           { wins: 0, times: [], avgMs: 0 },
  jsqrWorker:      { wins: 0, times: [], avgMs: 0 },
  jsqrMain:        { wins: 0, times: [], avgMs: 0 },
};
let _preferredEngine = 'auto';  // 'auto' = benchmark actif

// ══════════════════════════════════════════════════════════════════════
//  WEBWORKER jsQR POOL (3 workers parallèles)
// ══════════════════════════════════════════════════════════════════════
const WORKER_COUNT = 3;
const _workers       = [];
const _workerBusy    = [];
const _workerQueue   = [];
let   _workerIdSeq   = 0;
const _pendingCallbacks = new Map();

const WORKER_SRC = `
  importScripts('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js');
  self.onmessage = function(e) {
    const { id, buf, width, height, invert, boost } = e.data;
    const data = new Uint8ClampedArray(buf);
    const t0 = performance.now();
    let result = null;

    const attempt = invert ? 'onlyInvert'
                  : boost  ? 'attemptBoth'
                  : 'dontInvert';
    try {
      const r = jsQR(data, width, height, { inversionAttempts: attempt });
      if (r) result = r.data;
    } catch(ex) {}

    // Deuxième tentative avec inversion si rien trouvé
    if (!result && !invert && !boost) {
      try {
        const r2 = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
        if (r2) result = r2.data;
      } catch(ex) {}
    }

    self.postMessage({ id, result, ms: performance.now() - t0 }, result ? [] : []);
  };
`;

(function _initWorkerPool() {
  try {
    const blob = new Blob([WORKER_SRC], { type: 'application/javascript' });
    const url  = URL.createObjectURL(blob);
    for (let i = 0; i < WORKER_COUNT; i++) {
      const w = new Worker(url);
      w.onmessage = _onWorkerMsg;
      w.onerror   = () => { _workers[i] = null; };
      _workers.push(w);
      _workerBusy.push(false);
    }
  } catch(e) {
    // Workers non supportés — fallback main thread
  }
})();

function _onWorkerMsg(e) {
  const { id, result, ms } = e.data;
  // Trouver quel worker a répondu
  const widx = _workers.indexOf(e.target);
  if (widx >= 0) _workerBusy[widx] = false;

  // Récupérer le callback
  const cb = _pendingCallbacks.get(id);
  if (cb) {
    _pendingCallbacks.delete(id);
    cb(result, ms);
  }

  // Traiter la file en attente
  if (_workerQueue.length > 0) {
    const next = _workerQueue.shift();
    _dispatchToFreeWorker(next);
  }
}

function _getFreeWorkerIdx() {
  for (let i = 0; i < _workers.length; i++) {
    if (_workers[i] && !_workerBusy[i]) return i;
  }
  return -1;
}

function _dispatchToFreeWorker(task) {
  const widx = _getFreeWorkerIdx();
  if (widx < 0) {
    // Tous occupés — garder seulement les 2 derniers
    if (_workerQueue.length >= 2) _workerQueue.shift();
    _workerQueue.push(task);
    return;
  }
  _workerBusy[widx] = true;
  _pendingCallbacks.set(task.id, task.cb);
  // Transférer le buffer pour zéro-copie
  try {
    _workers[widx].postMessage(
      { id: task.id, buf: task.buf, width: task.w, height: task.h, invert: task.invert, boost: task.boost },
      [task.buf]
    );
  } catch(ex) {
    // Buffer déjà transféré — recréer depuis les données
    _workerBusy[widx] = false;
    task.cb(null, 0);
  }
}

function _decodeWithWorker(imageData, w, h, invert, boost, cb) {
  if (!_workers.some(Boolean)) {
    // Aucun worker — main thread
    _jsqrMainThread(imageData, w, h, cb);
    return;
  }
  const id  = ++_workerIdSeq;
  const buf = imageData.data.buffer.slice(0);  // copie pour transfert
  _dispatchToFreeWorker({ id, buf, w, h, invert, boost, cb });
}

// ── jsQR main thread fallback ─────────────────────────────────────
function _jsqrMainThread(imageData, w, h, cb) {
  const t0 = performance.now();
  let result = null;
  try {
    const r = jsQR(imageData.data, w, h, { inversionAttempts: 'attemptBoth' });
    if (r) result = r.data;
  } catch(e) {}
  if (cb) cb(result, performance.now() - t0);
}

// ══════════════════════════════════════════════════════════════════════
//  BarcodeDetector NATIF (Chrome Android 83+)
// ══════════════════════════════════════════════════════════════════════
let _barcodeDetector = null;
let _bdBusy          = false;

(async function _initBarcodeDetector() {
  try {
    if (typeof BarcodeDetector === 'undefined') return;
    const fmts = await BarcodeDetector.getSupportedFormats();
    if (!fmts.includes('qr_code')) return;
    _barcodeDetector = new BarcodeDetector({ formats: ['qr_code'] });
    _engineName = 'BarcodeDetector';
    _updateEngineBadge('⚡ Native BarcodeDetector');
  } catch(e) {}
})();

async function _decodeBarcodeDetector(video) {
  if (_bdBusy || !_barcodeDetector) return null;
  _bdBusy = true;
  const t0 = performance.now();
  try {
    const codes = await _barcodeDetector.detect(video);
    const ms = performance.now() - t0;
    _bdBusy = false;
    if (codes.length > 0) {
      _recordBenchmark('barcodeDetector', ms);
      return codes[0].rawValue;
    }
  } catch(e) { _bdBusy = false; }
  return null;
}

// ══════════════════════════════════════════════════════════════════════
//  ZXing WASM — Fallback haute robustesse
// ══════════════════════════════════════════════════════════════════════
let _zxingDecoder  = null;
let _zxingLoading  = false;
let _zxingBusy     = false;
let _zxingFails    = 0;

function _loadZXing() {
  if (_zxingDecoder || _zxingLoading) return;
  _zxingLoading = true;
  const script  = document.createElement('script');
  script.src    = 'https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/index.min.js';
  script.onload = () => {
    try {
      if (typeof ZXingBrowser !== 'undefined') {
        _zxingDecoder = new ZXingBrowser.BrowserQRCodeReader();
        _updateEngineBadge(_barcodeDetector ? '⚡ BarcodeDetector + ZXing' : '🔬 ZXing + jsQR');
      }
    } catch(e) {}
    _zxingLoading = false;
  };
  script.onerror = () => { _zxingLoading = false; };
  document.head.appendChild(script);
}

// ══════════════════════════════════════════════════════════════════════
//  BENCHMARK MOTEUR — Sélection automatique du meilleur
// ══════════════════════════════════════════════════════════════════════
function _recordBenchmark(engine, ms) {
  const e = _engineBenchmark[engine];
  if (!e) return;
  e.wins++;
  e.times.push(ms);
  if (e.times.length > 20) e.times.shift();
  e.avgMs = e.times.reduce((a, b) => a + b, 0) / e.times.length;
}

function _bestEngine() {
  if (_preferredEngine !== 'auto') return _preferredEngine;
  let best = null, bestScore = Infinity;
  for (const [name, data] of Object.entries(_engineBenchmark)) {
    if (data.wins === 0) continue;
    const score = data.avgMs / (data.wins + 1);
    if (score < bestScore) { bestScore = score; best = name; }
  }
  return best || 'jsqrWorker';
}

// ══════════════════════════════════════════════════════════════════════
//  PIPELINE VISION — Prétraitement image
// ══════════════════════════════════════════════════════════════════════
const _procCanvas = document.createElement('canvas');
const _procCtx    = _procCanvas.getContext('2d', { willReadFrequently: true });

// Redimensionnement haute qualité
function _resizeFrame(srcCanvas, srcW, srcH, dstW, dstH) {
  _procCanvas.width  = dstW;
  _procCanvas.height = dstH;
  _procCtx.drawImage(srcCanvas, 0, 0, srcW, srcH, 0, 0, dstW, dstH);
  return _procCtx.getImageData(0, 0, dstW, dstH);
}

// Boost contraste + netteté (sharpening convolution légère)
function _enhanceImageData(imgData) {
  const d = imgData.data;
  const w = imgData.width;
  const h = imgData.height;

  // Estimer luminosité pour auto-torch
  let lumSum = 0;
  for (let i = 0; i < d.length; i += 40) {
    lumSum += (d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114);
  }
  _lastLightLevel = lumSum / (d.length / 40);
  _updateLightIndicator(_lastLightLevel);

  // Pas de traitement si image déjà bien exposée
  if (_lastLightLevel > 100 && _lastLightLevel < 220) return imgData;

  // Boost contraste adaptatif pour basse/haute lumière
  const factor = _lastLightLevel < 80 ? 2.2 : _lastLightLevel > 220 ? 0.7 : 1.0;
  for (let i = 0; i < d.length; i += 4) {
    d[i]   = Math.min(255, Math.max(0, (d[i]   - 128) * factor + 128));
    d[i+1] = Math.min(255, Math.max(0, (d[i+1] - 128) * factor + 128));
    d[i+2] = Math.min(255, Math.max(0, (d[i+2] - 128) * factor + 128));
  }
  return imgData;
}

// Noyau sharpening rapide (améliore QR flous)
function _sharpenImageData(imgData) {
  const src = new Uint8ClampedArray(imgData.data);
  const dst = imgData.data;
  const w   = imgData.width;
  const h   = imgData.height;
  // Kernel: [0,-1,0,-1,5,-1,0,-1,0]
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      const t = ((y-1)*w+x)*4, b = ((y+1)*w+x)*4;
      const l = (y*w+(x-1))*4,  r = (y*w+(x+1))*4;
      for (let c = 0; c < 3; c++) {
        dst[i+c] = Math.min(255, Math.max(0,
          5*src[i+c] - src[t+c] - src[b+c] - src[l+c] - src[r+c]
        ));
      }
    }
  }
  return imgData;
}

// Rotation canvas pour scan multi-angle
const _rotCanvas = document.createElement('canvas');
const _rotCtx    = _rotCanvas.getContext('2d', { willReadFrequently: true });

function _rotateImageData(srcCanvas, srcW, srcH, angleDeg) {
  const rad = angleDeg * Math.PI / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const dw  = Math.round(srcW * cos + srcH * sin);
  const dh  = Math.round(srcW * sin + srcH * cos);
  _rotCanvas.width  = dw;
  _rotCanvas.height = dh;
  _rotCtx.clearRect(0, 0, dw, dh);
  _rotCtx.save();
  _rotCtx.translate(dw / 2, dh / 2);
  _rotCtx.rotate(rad);
  _rotCtx.drawImage(srcCanvas, -srcW / 2, -srcH / 2);
  _rotCtx.restore();
  return _rotCtx.getImageData(0, 0, dw, dh);
}

// ── Indicateurs UI qualité ────────────────────────────────────────
function _updateLightIndicator(level) {
  const el = document.getElementById('sq-light');
  if (!el) return;
  if (level < 60) {
    el.textContent = '💡 Sombre';
    el.className   = 'sq-indicator sq-light';
    _autoTorchCheck();
  } else if (level > 210) {
    el.textContent = '💡 Surexposé';
    el.className   = 'sq-indicator sq-light';
  } else {
    el.textContent = '💡 OK';
    el.className   = 'sq-indicator sq-light ok';
  }
}

function _updateFocusIndicator(ok) {
  const el = document.getElementById('sq-focus');
  if (!el) return;
  _focusOk = ok;
  el.textContent = ok ? '🎯 Focus' : '🎯 AF…';
  el.className   = 'sq-indicator sq-focus' + (ok ? ' ok' : '');
}

// Torch automatique si trop sombre
let _autoTorchTimer = null;
function _autoTorchCheck() {
  if (_autoTorchOn || !_torchSupported || _torchOn) return;
  clearTimeout(_autoTorchTimer);
  _autoTorchTimer = setTimeout(async () => {
    if (_lastLightLevel < 60 && !_torchOn && _torchTrack) {
      _torchOn = true;
      _autoTorchOn = true;
      try {
        await _torchTrack.applyConstraints({ advanced: [{ torch: true }] });
        const btn = document.getElementById('btn-torch');
        if (btn) {
          btn.style.background = 'rgba(200,245,90,.45)';
          btn.style.boxShadow  = '0 0 12px rgba(200,245,90,.6)';
          btn.textContent      = '💡';
        }
      } catch(e) { _torchOn = false; _autoTorchOn = false; }
    }
  }, 1800);
}

function _autoTorchOff() {
  if (!_autoTorchOn) return;
  _autoTorchOn = false;
  if (!_torchTrack) return;
  _torchTrack.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {});
  _torchOn = false;
  const btn = document.getElementById('btn-torch');
  if (btn) {
    btn.style.background = 'rgba(0,0,0,.55)';
    btn.style.boxShadow  = 'none';
    btn.textContent      = '🔦';
  }
}

function _updateEngineBadge(text) {
  const el = document.getElementById('engine-badge');
  if (el) el.textContent = text;
}

// ══════════════════════════════════════════════════════════════════════
//  CAMÉRA — SÉLECTION INTELLIGENTE & CONTRAINTES INDUSTRIELLES
// ══════════════════════════════════════════════════════════════════════

// Construire un tableau de contraintes optimisées par ordre de préférence
function _buildCameraConstraints() {
  return [
    // 1. Arrière HD 60fps avec toutes les optimisations
    { video: {
        facingMode: { exact: 'environment' },
        width:      { ideal: 1920, min: 640 },
        height:     { ideal: 1080, min: 480 },
        frameRate:  { ideal: 60,   min: 24 },
        focusMode:  'continuous',
        exposureMode: 'continuous',
        whiteBalanceMode: 'continuous',
    }},
    // 2. Arrière HD 30fps tolérant
    { video: {
        facingMode: { exact: 'environment' },
        width:  { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 },
    }},
    // 3. Arrière 720p idéal
    { video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 },
    }},
    // 4. Arrière toute résolution
    { video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } } },
    // 5. N'importe quelle caméra HD
    { video: { width: { ideal: 1280 }, height: { ideal: 720 } } },
    // 6. Dernier recours
    { video: true },
  ];
}

// Sélectionner la meilleure caméra arrière parmi les tracks disponibles
async function _selectBestCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    return _buildCameraConstraints();
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams    = devices.filter(d => d.kind === 'videoinput');
    // Trouver la caméra avec le meilleur label (arrière, pas ultra-wide, pas macro)
    // Sur Android les IDs sont opaques — on se fie au label
    const backCams = cams.filter(c => {
      const lbl = c.label.toLowerCase();
      return lbl.includes('back') || lbl.includes('arrière') || lbl.includes('rear') ||
             lbl.includes('environment') || (!lbl.includes('front') && !lbl.includes('avant'));
    });
    // Éviter ultra-wide (fish-eye) si possible
    const preferred = backCams.filter(c => {
      const lbl = c.label.toLowerCase();
      return !lbl.includes('ultra') && !lbl.includes('wide') && !lbl.includes('macro');
    });
    const best = preferred[0] || backCams[0] || cams[0];
    if (best && best.deviceId) {
      return [
        { video: { deviceId: { exact: best.deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } } },
        { video: { deviceId: { ideal: best.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } },
        ..._buildCameraConstraints(),
      ];
    }
  } catch(e) {}
  return _buildCameraConstraints();
}

// Appliquer les contraintes avancées après ouverture du stream
async function _applyAdvancedConstraints(track) {
  if (!track || !track.getCapabilities) return;
  const caps = track.getCapabilities();
  const adv  = [];

  if (caps.focusMode?.includes('continuous'))       adv.push({ focusMode: 'continuous' });
  if (caps.exposureMode?.includes('continuous'))    adv.push({ exposureMode: 'continuous' });
  if (caps.whiteBalanceMode?.includes('continuous')) adv.push({ whiteBalanceMode: 'continuous' });
  if (caps.zoom?.min !== undefined)                 adv.push({ zoom: caps.zoom.min });
  if (caps.sharpness?.max !== undefined)            adv.push({ sharpness: Math.round(caps.sharpness.max * 0.7) });
  if (caps.contrast?.max !== undefined)             adv.push({ contrast: Math.round(caps.contrast.max * 0.6) });
  if (caps.brightness?.max !== undefined && caps.brightness?.min !== undefined) {
    adv.push({ brightness: Math.round((caps.brightness.max + caps.brightness.min) / 2) });
  }

  if (adv.length > 0) {
    try { await track.applyConstraints({ advanced: adv }); } catch(e) {}
  }

  // Enregistrer le track pour la torche et le zoom
  _torchTrack   = track;
  _torchSupported = !!(caps.torch);
  if (!_torchSupported) {
    const btn = document.getElementById('btn-torch');
    if (btn) btn.style.opacity = '0.35';
  }

  _updateFocusIndicator(true);
}

// ══════════════════════════════════════════════════════════════════════
//  TORCHE NATIVE ANDROID
// ══════════════════════════════════════════════════════════════════════
async function toggleTorch() {
  if (!sharedStream) return;
  const track = sharedStream.getVideoTracks()[0];
  if (!track) return;
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  const btn  = document.getElementById('btn-torch');
  if (!caps.torch) {
    if (btn) { btn.style.opacity = '0.3'; btn.title = 'Torche non supportée'; }
    return;
  }
  _torchOn = !_torchOn;
  _autoTorchOn = false; // désactiver auto si manuel
  _torchTrack  = track;
  try {
    await track.applyConstraints({ advanced: [{ torch: _torchOn }] });
    if (btn) {
      btn.style.background = _torchOn ? 'rgba(200,245,90,.45)' : 'rgba(0,0,0,.55)';
      btn.style.boxShadow  = _torchOn ? '0 0 12px rgba(200,245,90,.6)' : 'none';
      btn.textContent      = _torchOn ? '💡' : '🔦';
    }
  } catch(e) { _torchOn = !_torchOn; }
}

// ══════════════════════════════════════════════════════════════════════
//  LIFECYCLE CAMÉRA — Recovery automatique
// ══════════════════════════════════════════════════════════════════════
function _initCameraLifecycle() {
  document.addEventListener('visibilitychange', _onVisibilityChange);
  window.addEventListener('focus',    () => setTimeout(_checkResumeCamera, 600));
  window.addEventListener('pagehide', () => { _pageHideTs = Date.now(); });
  window.addEventListener('pageshow', e => {
    if (e.persisted || Date.now() - _pageHideTs > 2000) {
      setTimeout(_checkResumeCamera, 700);
    }
  });
  window.addEventListener('orientationchange', () => setTimeout(_checkResumeCamera, 1000));
}

function _onVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    _pageHideTs = Date.now();
  } else {
    setTimeout(_checkResumeCamera, 400);
  }
}

async function _checkResumeCamera() {
  if (!_mainVideo || !sharedStream) return;
  const tracks = sharedStream.getVideoTracks();
  if (!tracks.length || tracks[0].readyState === 'ended') {
    await _restartStreamFull();
    return;
  }
  if (_mainVideo.paused || _mainVideo.ended) {
    _mainVideo.play().catch(() => _restartStreamFull());
  }
}

async function _restartStreamFull() {
  if (sharedStream) {
    sharedStream.getTracks().forEach(t => t.stop());
    sharedStream = null;
  }
  if (_mainVideo) _mainVideo.srcObject = null;

  const constraints = await _selectBestCamera();
  for (const c of constraints) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(c);
      sharedStream = stream;
      if (_mainVideo) {
        _mainVideo.srcObject = stream;
        await _mainVideo.play().catch(() => {});
      }
      const track = stream.getVideoTracks()[0];
      await _applyAdvancedConstraints(track);
      // Réactiver torche si elle était allumée
      if (_torchOn && _torchTrack) {
        setTimeout(() => {
          _torchTrack.applyConstraints({ advanced: [{ torch: true }] }).catch(() => {});
        }, 800);
      }
      break;
    } catch(e) {}
  }
}

// Restart léger (freeze caméra sans perte de permission)
function _restartCameraLight() {
  if (!_mainVideo || !sharedStream) return;
  _mainVideo.srcObject = null;
  setTimeout(() => {
    if (_mainVideo && sharedStream) {
      _mainVideo.srcObject = sharedStream;
      _mainVideo.play().catch(() => _restartStreamFull());
    }
  }, 200);
}

// ══════════════════════════════════════════════════════════════════════
//  HASH RAPIDE ANTI-FREEZE
// ══════════════════════════════════════════════════════════════════════
function _hashFrame(data, w, h) {
  let sum = 0;
  // Échantillonner ~200 pixels répartis sur l'image
  const step = Math.max(1, Math.floor(data.length / 800));
  for (let i = 0; i < data.length; i += step) {
    sum = ((sum << 5) - sum + data[i]) | 0;
  }
  return sum;
}

// ══════════════════════════════════════════════════════════════════════
//  FLASH VISUEL & SON PREMIUM
// ══════════════════════════════════════════════════════════════════════
function _flashSuccess() {
  const overlay = document.querySelector('.scanner-overlay');
  if (!overlay) return;
  if (!document.getElementById('_flashKF')) {
    const s = document.createElement('style');
    s.id = '_flashKF';
    s.textContent = '@keyframes _flashAnim{0%{opacity:1}100%{opacity:0}}';
    document.head.appendChild(s);
  }
  const div = document.createElement('div');
  div.style.cssText = 'position:absolute;inset:0;background:rgba(74,222,128,0.4);border-radius:14px;pointer-events:none;z-index:30;animation:_flashAnim 0.4s ease-out forwards';
  overlay.appendChild(div);
  setTimeout(() => div.remove(), 420);
}

let _audioCtx = null;
function _getAudio() {
  if (!_audioCtx || _audioCtx.state === 'closed') {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}

function _playBeep(type) {
  try {
    const ctx  = _getAudio();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    if (type === 'success') {
      // Triple bip ascendant premium
      [[880,0],[1050,0.11],[1320,0.22]].forEach(([freq, delay]) => {
        const osc = ctx.createOscillator();
        osc.connect(gain);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
        gain.gain.setValueAtTime(0, ctx.currentTime + delay);
        gain.gain.linearRampToValueAtTime(0.13, ctx.currentTime + delay + 0.01);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + delay + 0.09);
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + 0.1);
      });
    } else {
      const osc = ctx.createOscillator();
      osc.connect(gain);
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(300, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(150, ctx.currentTime + 0.22);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.25);
      osc.start(); osc.stop(ctx.currentTime + 0.25);
    }
  } catch(e) {}
}

// ══════════════════════════════════════════════════════════════════════
//  DÉMARRAGE SCANNER PRINCIPAL — Boucle RAF 60fps multi-pipeline
// ══════════════════════════════════════════════════════════════════════
function startScanner() {
  if (!sharedStream) {
    showErr('Caméra inaccessible', "Autorisez l'accès à la caméra dans les paramètres du navigateur.");
    return;
  }

  // Nettoyer ancienne instance
  if (_mainAnimFrame) { cancelAnimationFrame(_mainAnimFrame); _mainAnimFrame = null; }
  const container = document.getElementById('qr-reader');
  const oldVid = container.querySelector('video');
  if (oldVid) oldVid.remove();

  // Créer la vidéo
  const video = document.createElement('video');
  video.setAttribute('autoplay', '');
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;border-radius:14px;';
  container.appendChild(video);
  video.srcObject = sharedStream;
  _mainVideo = video;

  // Appliquer contraintes avancées après chargement
  video.addEventListener('loadedmetadata', () => {
    const track = sharedStream?.getVideoTracks()[0];
    if (track) _applyAdvancedConstraints(track);
  }, { once: true });
  video.play().catch(() => {});

  // Initialiser lifecycle et ZXing en background
  _initCameraLifecycle();
  setTimeout(_loadZXing, 3500);

  // Afficher le moteur actif
  _updateEngineBadge(_barcodeDetector ? '⚡ BarcodeDetector + jsQR v9' : '🔍 jsQR HyperScan v9');

  // ── BOUCLE PRINCIPALE RAF ────────────────────────────────────────
  let qualityFrameCount = 0;
  let angleToggle = 0;

  (function tick(ts) {
    _mainAnimFrame = requestAnimationFrame(tick);

    if (_scanPaused || scanCooldown) return;
    if (video.readyState < video.HAVE_ENOUGH_DATA) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    _frameCount++;
    qualityFrameCount++;

    // ── BarcodeDetector : chaque frame (natif GPU) ───────────────
    if (_barcodeDetector && !_bdBusy && _frameCount % 1 === 0) {
      _decodeBarcodeDetector(video).then(result => {
        if (result && !scanCooldown && !_scanPaused) _onQrFound(result, 'barcodeDetector');
      });
    }

    // ── Throttle du pipeline manuel ──────────────────────────────
    if (ts - _lastScanTs < DECODE_INTERVAL) return;
    _lastScanTs = ts;

    // ── Dessiner frame courant ───────────────────────────────────
    _mainCanvas.width  = vw;
    _mainCanvas.height = vh;
    _mainCtx.drawImage(video, 0, 0);

    // ── Anti-freeze ──────────────────────────────────────────────
    const imgData = _mainCtx.getImageData(0, 0, vw, vh);
    const hash    = _hashFrame(imgData.data, vw, vh);
    if (hash === _lastFrameHash) {
      _frozenCount++;
      if (_frozenCount > FREEZE_THRESHOLD) {
        _frozenCount = 0;
        _restartCameraLight();
      }
      return;
    }
    _lastFrameHash = hash;
    _frozenCount   = 0;

    // ── Check qualité image (toutes les N frames) ────────────────
    if (qualityFrameCount >= QUALITY_CHECK_INT) {
      qualityFrameCount = 0;
      _enhanceImageData(imgData);  // met à jour _lastLightLevel
    }

    // ── Décodages parallèles multi-résolution ────────────────────

    // RÉSOLUTION NATIVE — Worker 0
    _decodeWithWorker(imgData, vw, vh, false, false, (result, ms) => {
      if (result && !scanCooldown && !_scanPaused) {
        _recordBenchmark('jsqrWorker', ms);
        _onQrFound(result, 'jsqrWorker');
      }
    });

    // 75% RÉSOLUTION avec boost — Worker 1 (toutes les 2 frames)
    if (_frameCount % 2 === 0 && vw > 600) {
      const sw = Math.round(vw * 0.75);
      const sh = Math.round(vh * 0.75);
      const small = _resizeFrame(_mainCanvas, vw, vh, sw, sh);
      _decodeWithWorker(small, sw, sh, false, true, (result, ms) => {
        if (result && !scanCooldown && !_scanPaused) {
          _recordBenchmark('jsqrWorker', ms);
          _onQrFound(result, 'jsqrWorker-75');
        }
      });
    }

    // 50% RÉSOLUTION — Worker 2 (toutes les 3 frames)
    if (_frameCount % 3 === 0 && vw > 800) {
      const sw2 = Math.round(vw * 0.5);
      const sh2 = Math.round(vh * 0.5);
      const half = _resizeFrame(_mainCanvas, vw, vh, sw2, sh2);
      _decodeWithWorker(half, sw2, sh2, false, true, (result, ms) => {
        if (result && !scanCooldown && !_scanPaused) {
          _recordBenchmark('jsqrWorker', ms);
          _onQrFound(result, 'jsqrWorker-50');
        }
      });
    }

    // 25% RÉSOLUTION — main thread (toutes les 5 frames, QR éloignés)
    if (_frameCount % 5 === 0 && vw > 1200) {
      const sw3 = Math.round(vw * 0.25);
      const sh3 = Math.round(vh * 0.25);
      const tiny = _resizeFrame(_mainCanvas, vw, vh, sw3, sh3);
      _jsqrMainThread(tiny, sw3, sh3, (result, ms) => {
        if (result && !scanCooldown && !_scanPaused) {
          _recordBenchmark('jsqrMain', ms);
          _onQrFound(result, 'jsqrMain-25');
        }
      });
    }

    // SCAN INVERSÉ — QR sombres sur fond clair (toutes les 4 frames)
    if (_frameCount % 4 === 0) {
      _decodeWithWorker(imgData, vw, vh, true, false, (result, ms) => {
        if (result && !scanCooldown && !_scanPaused) {
          _recordBenchmark('jsqrWorker', ms);
          _onQrFound(result, 'jsqrWorker-inv');
        }
      });
    }

    // SCAN MULTI-ANGLE ±15° (toutes les 7 frames, QR inclinés)
    if (_frameCount % 7 === 0) {
      angleToggle = (angleToggle + 1) % 2;
      const angleDeg = angleToggle === 0 ? 15 : -15;
      try {
        const rotated = _rotateImageData(_mainCanvas, vw, vh, angleDeg);
        _decodeWithWorker(rotated, rotated.width, rotated.height, false, true, (result, ms) => {
          if (result && !scanCooldown && !_scanPaused) {
            _recordBenchmark('jsqrWorker', ms);
            _onQrFound(result, 'jsqrWorker-angle');
          }
        });
      } catch(e) {}
    }

    // ZXing fallback (toutes les 10 frames si actif)
    if (_frameCount % 10 === 0 && _zxingDecoder && !_zxingBusy && _zxingFails < 5) {
      _zxingBusy = true;
      const t0 = performance.now();
      try {
        // ZXing via ImageData → HTMLCanvasElement
        const zCanvas = document.createElement('canvas');
        zCanvas.width  = Math.min(vw, 640);
        zCanvas.height = Math.min(vh, 480);
        const zCtx = zCanvas.getContext('2d');
        zCtx.drawImage(_mainCanvas, 0, 0, vw, vh, 0, 0, zCanvas.width, zCanvas.height);
        _zxingDecoder.decodeFromCanvas(zCanvas).then(r => {
          const ms = performance.now() - t0;
          _zxingBusy = false;
          if (r && !scanCooldown && !_scanPaused) {
            _recordBenchmark('zxing', ms);
            _onQrFound(r.getText(), 'zxing');
          }
        }).catch(() => {
          _zxingBusy = false;
          _zxingFails++;
        });
      } catch(e) { _zxingBusy = false; }
    }

  })(0);
}

// ── QR Trouvé ────────────────────────────────────────────────────────
function _onQrFound(text, engine) {
  if (scanCooldown || _scanPaused || !text || !text.trim()) return;

  // Normaliser le QR
  text = _normalizeQR(text);
  if (!text) return;

  scanCooldown = true;
  _scanPaused  = true;

  // Désactiver auto-torch si lumière revenue
  if (_lastLightLevel > 100) _autoTorchOff();

  // Feedback multisensoriel instantané
  _flashSuccess();
  if (navigator.vibrate) navigator.vibrate([25, 10, 45, 10, 25]);
  _playBeep('success');

  onScanSuccess(text);
}

// ── Normalisation QR — nettoyage robuste + parsing JSON BarOS ─────────
// Le gestionnaire génère : {"employee_id":"<uuid>","nom":"...","role":"...","etab_id":"...","pin":""}
// On extrait l'employee_id et on retourne la chaîne nettoyée.
// _parsedQR stocke l'objet JSON pour _findEmployeUniversal.
let _parsedQR = null;

function _normalizeQR(raw) {
  if (!raw) return null;
  _parsedQR = null;

  // Supprimer BOM et caractères de contrôle
  let s = raw.replace(/^\uFEFF/, '').trim();
  s = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  s = s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  s = s.trim();

  if (!s) return null;

  // ── Cas 1 : JSON BarOS {"employee_id":"...", ...} ─────────────────
  if (s.startsWith('{')) {
    try {
      const obj = JSON.parse(s);
      _parsedQR = obj;
      // Extraire l'ID : employee_id en priorité, sinon id
      const empId = obj.employee_id || obj.id || obj.emp_id || null;
      if (empId) return String(empId).trim();
    } catch(e) {
      // JSON malformé — continuer avec la chaîne brute
    }
  }

  // ── Cas 2 : UUID ou préfixe BarOS brut ───────────────────────────
  const noPrefix = s.startsWith('BAROS-EMP-') ? s.replace('BAROS-EMP-', '')
                 : s.startsWith('EMP-')        ? s.replace('EMP-', '')
                 : s;

  return noPrefix.trim() || null;
}

async function onScanSuccess(decodedText) {
  await handleScan(decodedText);
  setTimeout(() => { scanCooldown = false; _scanPaused = false; }, AUTO_CLOSE_MS);
}

// ══════════════════════════════════════════════════════════════════════
//  LOGIQUE POINTAGE — Recherche universelle employés
//  Cherche dans : qr_token → qr_code → badge_id → id → numero_employe
// ══════════════════════════════════════════════════════════════════════
async function handleScan(qrText) {
  const now   = new Date();
  const heure = now.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
  const today = todayStr();

  // ── 1. Résolution employé — 3 sources par ordre de priorité ────
  //
  //  SOURCE A : Supabase (si connecté) → données complètes + fiables
  //  SOURCE B : Cache localStorage     → chargé au démarrage ou scan précédent
  //  SOURCE C : JSON embarqué dans QR  → fonctionne TOUJOURS hors-ligne
  //             Le QR BarOS contient : {"employee_id":"...","nom":"...","role":"...","etab_id":"..."}
  //             On construit un employé minimal directement depuis ces données.

  let emp = null;

  // SOURCE A — Supabase
  if (navigator.onLine && db) {
    emp = await _findEmployeUniversal(qrText);
    if (emp) cacheEmp(emp);
  }

  // SOURCE B — Cache localStorage
  if (!emp) {
    emp = getCachedEmp(qrText);
  }

  // SOURCE C — JSON embarqué dans le QR (fallback offline garanti)
  // _parsedQR est rempli par _normalizeQR() avant que handleScan soit appelé
  if (!emp && _parsedQR && (_parsedQR.employee_id || _parsedQR.id)) {
    const empId  = String(_parsedQR.employee_id || _parsedQR.id || '').trim();
    const empNom = String(_parsedQR.nom  || '').trim();
    const empRole= String(_parsedQR.role || '').trim();

    // [FIX C3] Exiger que l'etab_id du QR corresponde à l'établissement configuré.
    // Si ETAB_ID non configuré → refuser : la tablette doit être initialisée avant usage.
    const qrEtab = String(_parsedQR.etab_id || '').trim();
    const etabOk = ETAB_ID && qrEtab && qrEtab === ETAB_ID;

    if (empId && etabOk) {
      emp = {
        id:         empId,
        nom:        empNom  || 'Employé',
        poste:      empRole || 'Employé',
        photo_url:  null,
        actif:      true,       // données minimales depuis QR — vérif Supabase impossible offline
        heure_debut: null,
        heure_fin:   null,
        qr_code:    null,
        _fromQR:    true,       // flag : données minimales depuis QR, pas de Supabase
      };
      // Mettre en cache pour les prochains scans offline
      cacheEmp(emp);
    }
  }

  if (!emp) {
    _playBeep('error');
    if (navigator.vibrate) navigator.vibrate([80, 30, 80, 30, 80]);
    showErrCard('Badge non reconnu', 'Ce QR code ne correspond à aucun employe enregistre.\n\nCode scanne : ' + qrText.substring(0, 40));
    setTimeout(() => { scanCooldown = false; _scanPaused = false; }, 5000);
    return;
  }

  // ── Vérifier actif — seulement si données Supabase (pas QR direct) ──
  if (!emp._fromQR && (emp.actif === false || emp.actif === 0)) {
    _playBeep('error');
    if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 100]);
    showSuspended(emp);
    setTimeout(() => { scanCooldown = false; _scanPaused = false; }, 8000);
    return;
  }

  // ── 2. Vérifier pointage existant aujourd'hui ────────────────────
  let pointageExistant = null;
  if (navigator.onLine && db) {
    try {
      const { data } = await db.from('pointages')
        .select('*')
        .eq('employe_id', emp.id)
        .eq('date_pointage', today)
        .order('created_at', { ascending: true })
        .limit(1)
        .single();
      pointageExistant = data;
    } catch(e) {}
  } else {
    pointageExistant = getOfflinePointage(emp.id, today);
  }

  // ── 3. Décider arrivée ou sortie ──────────────────────────────────
  const isSortie = !!(pointageExistant && pointageExistant.heure_arrivee && !pointageExistant.heure_sortie);
  const action   = isSortie ? 'sortie' : 'arrivee';

  // ── 4. Calculer retard / avance ───────────────────────────────────
  let statutTemps = 'ok';
  let deltaMin    = 0;
  if (action === 'arrivee' && emp.heure_debut) {
    const [hP, mP] = emp.heure_debut.split(':').map(Number);
    const [hA, mA] = heure.split(':').map(Number);
    deltaMin = (hA * 60 + mA) - (hP * 60 + mP);
    if (deltaMin > 10)      statutTemps = 'retard';
    else if (deltaMin < -5) statutTemps = 'avance';
  }

  // ── 5. Enregistrer ────────────────────────────────────────────────
  const record = {
    employe_id:    emp.id,
    etab_id:       ETAB_ID,
    date_pointage: today,
    heure_arrivee: action === 'arrivee' ? heure : (pointageExistant?.heure_arrivee || null),
    heure_sortie:  action === 'sortie'  ? heure : null,
    statut:        statutTemps,
  };

  if (navigator.onLine && db) {
    try {
      if (action === 'arrivee') {
        await db.from('pointages').upsert(record, { onConflict: 'employe_id,date_pointage' });
      } else {
        await db.from('pointages')
          .update({ heure_sortie: heure })
          .eq('employe_id', emp.id)
          .eq('date_pointage', today)
          .eq('etab_id', ETAB_ID); // [FIX] filtre etab_id ajouté
      }
    } catch(e) {
      storeOffline(record, action);
    }
  } else {
    storeOffline(record, action);
  }

  // ── 6. Affichage et compteurs ─────────────────────────────────────
  showResultCard(emp, action, heure, statutTemps, deltaMin);
  await refreshCounters();

  const label = action === 'arrivee' ? '✅ Arrivée' : '🏁 Sortie';
  document.getElementById('last-scan-txt').textContent =
    `${label} de ${emp.nom} enregistrée à ${heure}`;
}

// ── Recherche universelle employé — schéma BarOS réel ────────────────
// Table employes : id, etab_id, nom, role, photo, plages_horaires, actif, pin, qr_code
// QR contient : {"employee_id":"<uuid>","nom":"...","role":"...","etab_id":"...","pin":""}
async function _findEmployeUniversal(qrText) {
  if (!db || !ETAB_ID) return null;

  // Champs réellement présents dans la table BarOS
  const selectFields = 'id,nom,role,photo,plages_horaires,actif,pin,qr_code,etab_id';

  // ── STRATÉGIE 1 : employee_id extrait du JSON (cas principal) ────
  // qrText est déjà l'UUID extrait par _normalizeQR
  const candidateId = qrText.trim();

  // Recherche directe par id (UUID)
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidateId)
              || /^[0-9a-f]{32}$/i.test(candidateId);

  if (isUUID || candidateId.length >= 20) {
    try {
      const { data, error } = await db.from('employes')
        .select(selectFields)
        .eq('id', candidateId)
        .eq('etab_id', ETAB_ID)
        .limit(1)
        .single();
      if (data && !error) return _normalizeEmp(data);
    } catch(e) {}

    // [FIX] Fallback sans etab_id supprimé — accepter uniquement l'établissement configuré
  }

  // ── STRATÉGIE 2 : employee_id du JSON diffère du candidateId — chercher par cet id avec etab_id ──
  // [FIX] Filtre etab_id ajouté — interdit de retrouver un employé étranger
  if (ETAB_ID && _parsedQR?.employee_id && _parsedQR.employee_id !== candidateId) {
    try {
      const { data } = await db.from('employes')
        .select(selectFields)
        .eq('id', _parsedQR.employee_id)
        .eq('etab_id', ETAB_ID)
        .limit(1)
        .single();
      if (data) return _normalizeEmp(data);
    } catch(e) {}
  }

  // ── STRATÉGIE 3 : Correspondance par qr_code (image base64/URL stockée) ──
  // Le champ qr_code contient l'image, pas la valeur — ignorer pour matching direct

  // ── STRATÉGIE 4 : Recherche par nom si présent dans le JSON ──────
  if (_parsedQR?.nom && _parsedQR.nom.trim()) {
    try {
      const { data } = await db.from('employes')
        .select(selectFields)
        .eq('etab_id', ETAB_ID)
        .ilike('nom', _parsedQR.nom.trim())
        .limit(1)
        .single();
      if (data) return _normalizeEmp(data);
    } catch(e) {}
  }

  // ── STRATÉGIE 5 : Lister tous les employés de l'établissement et comparer ──
  // Utile si l'UUID est légèrement corrompu (lecture QR imparfaite)
  try {
    const { data: allEmps } = await db.from('employes')
      .select(selectFields)
      .eq('etab_id', ETAB_ID)
      .eq('actif', true);

    if (allEmps?.length) {
      // Correspondance exacte id uniquement
      // [FIX] Correspondance partielle (8 chars) supprimée — trop permissive, risque d'usurpation
      const exact = allEmps.find(e => e.id === candidateId);
      if (exact) return _normalizeEmp(exact);
    }
  } catch(e) {}

  return null;
}

// Normaliser les données employé — schéma BarOS réel
// Colonnes : id, nom, role, photo, plages_horaires, actif, pin, qr_code, etab_id
function _normalizeEmp(data) {
  if (!data) return null;

  const plages = (() => {
    try {
      const raw = data.plages_horaires;
      if (typeof raw === 'string') return JSON.parse(raw);
      if (Array.isArray(raw)) return raw;
      return [];
    } catch(e) { return []; }
  })();

  // Chercher le planning du jour courant
  const jours = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
  const todayName = jours[new Date().getDay()];
  const planning = plages.find(p => {
    const j = (p.jour || p.day || '').toLowerCase();
    return j === todayName || j.startsWith(todayName.substring(0, 3));
  }) || plages[0] || {};

  return {
    id:          data.id,
    nom:         data.nom || 'Employé',
    poste:       data.role || 'Employé',          // BarOS utilise 'role' pas 'poste'
    photo_url:   data.photo || null,              // BarOS utilise 'photo' pas 'photo_url'
    actif:       data.actif !== false && data.actif !== 0,
    heure_debut: planning.debut || planning.heure_debut || planning.start || null,
    heure_fin:   planning.fin   || planning.heure_fin   || planning.end   || null,
    // Pour le cache offline
    qr_code:     data.qr_code || null,
  };
}

// ══════════════════════════════════════════════════════════════════════
//  AFFICHAGE CARTE RÉSULTAT PREMIUM
// ══════════════════════════════════════════════════════════════════════
let _countdownInterval = null;

function showResultCard(emp, action, heure, statutTemps, deltaMin) {
  clearTimeout(resultTimer);
  clearInterval(_countdownInterval);

  const card = document.getElementById('result-card');
  const hour = new Date().getHours();

  let welcomeMsg;
  if (action === 'arrivee') {
    if (hour < 12)      welcomeMsg = '☀️ Bonjour';
    else if (hour < 18) welcomeMsg = '👋 Bon après-midi';
    else                welcomeMsg = '🌙 Bonsoir';
  } else {
    welcomeMsg = hour < 17 ? '👋 Bonne fin de journée' : '🌙 Bonne soirée';
  }
  document.getElementById('rc-welcome').textContent = welcomeMsg;

  card.className = 'result-card';
  if (action === 'sortie')        card.classList.add('sortie-bg');
  else if (statutTemps === 'retard') card.classList.add('retard-bg');
  else if (statutTemps === 'avance') card.classList.add('avance-bg');
  else                               card.classList.add('arrive-bg');

  const statusEl = document.getElementById('rc-status');
  if (action === 'arrivee') {
    if (statutTemps === 'retard') {
      statusEl.className = 'rc-status retard';
      statusEl.textContent = '⚠️ Retard';
    } else if (statutTemps === 'avance') {
      statusEl.className = 'rc-status avance';
      statusEl.textContent = '⏰ En avance';
    } else {
      statusEl.className = 'rc-status arrive';
      statusEl.textContent = '✅ Arrivée';
    }
  } else {
    statusEl.className = 'rc-status sortie';
    statusEl.textContent = '🏁 Sortie enregistrée';
  }

  const photoEl = document.getElementById('rc-photo');
  if (emp.photo_url) {
    photoEl.innerHTML = `<img src="${emp.photo_url}" alt="${emp.nom}" onerror="this.parentElement.textContent='👤'">`;
  } else {
    photoEl.textContent = '👤';
  }

  document.getElementById('rc-nom').textContent   = emp.nom;
  document.getElementById('rc-poste').textContent = emp.poste || 'Employé';
  document.getElementById('rc-time-lbl').textContent = action === 'arrivee' ? "Heure d'arrivée" : "Heure de sortie";
  document.getElementById('rc-time-val').textContent = heure;

  const planEl = document.getElementById('rc-planning');
  if (emp.heure_debut || emp.heure_fin) {
    planEl.innerHTML = [
      emp.heure_debut ? `<div class="rc-plng-item"><div class="rc-plng-lbl">Début prévu</div><div class="rc-plng-val">${emp.heure_debut}</div></div>` : '',
      emp.heure_fin   ? `<div class="rc-plng-item"><div class="rc-plng-lbl">Fin prévue</div><div class="rc-plng-val">${emp.heure_fin}</div></div>` : '',
    ].join('');
    planEl.style.display = 'flex';
  } else {
    planEl.style.display = 'none';
  }

  const alertEl = document.getElementById('rc-alert');
  if (action === 'arrivee' && statutTemps !== 'ok') {
    alertEl.style.display = 'block';
    if (statutTemps === 'retard') {
      alertEl.className = 'rc-alert retard';
      alertEl.textContent = `⚠️ Retard de ${deltaMin} min par rapport au planning`;
    } else {
      alertEl.className = 'rc-alert avance';
      alertEl.textContent = `⏰ En avance de ${Math.abs(deltaMin)} min`;
    }
  } else if (action === 'arrivee') {
    alertEl.style.display = 'block';
    alertEl.className = 'rc-alert ok';
    alertEl.textContent = "✅ À l'heure — Bonne journée !";
  } else {
    alertEl.style.display = 'none';
  }

  card.classList.add('show');

  // Barre de fermeture auto 60s
  const fillEl = document.getElementById('rc-close-fill');
  fillEl.style.transition = 'none';
  fillEl.style.width = '100%';
  requestAnimationFrame(() => {
    fillEl.style.transition = 'width 60s linear';
    fillEl.style.width = '0%';
  });

  let remaining = 60;
  document.getElementById('rc-countdown').textContent = remaining;
  _countdownInterval = setInterval(() => {
    remaining--;
    const el = document.getElementById('rc-countdown');
    if (el) el.textContent = remaining;
    if (remaining <= 0) clearInterval(_countdownInterval);
  }, 1000);

  resultTimer = setTimeout(closeResult, AUTO_CLOSE_MS);
}

function closeResult() {
  document.getElementById('result-card').classList.remove('show');
  document.getElementById('result-card').className = 'result-card';
  clearTimeout(resultTimer);
  clearInterval(_countdownInterval);
  scanCooldown = false;
  _scanPaused  = false;
}

function showSuspended(emp) {
  const card = document.getElementById('suspended-card');
  const msg  = document.getElementById('susp-msg');
  const name = emp?.nom ? ` — ${emp.nom}` : '';
  msg.innerHTML = `Vous avez été suspendu de la boîte${name}.<br>Contactez votre manager pour plus d'informations.`;
  card.classList.add('show');
  setTimeout(closeSuspended, 8000);
}

function closeSuspended() {
  document.getElementById('suspended-card').classList.remove('show');
  scanCooldown = false;
  _scanPaused  = false;
}

// ══════════════════════════════════════════════════════════════════════
//  HORLOGE
// ══════════════════════════════════════════════════════════════════════
function updateClock() {
  const now = new Date();
  document.getElementById('hdr-time').textContent =
    now.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
  document.getElementById('hdr-date').textContent =
    now.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' });
}

function todayStr() { return new Date().toISOString().slice(0, 10); }
function nowTime()  { return new Date().toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' }); }

// ══════════════════════════════════════════════════════════════════════
//  COMPTEURS JOURNALIERS
// ══════════════════════════════════════════════════════════════════════
async function refreshCounters() {
  if (!navigator.onLine || !db) return;
  try {
    const { data } = await db.from('pointages')
      .select('heure_arrivee,heure_sortie,statut')
      .eq('etab_id', ETAB_ID)
      .eq('date_pointage', todayStr());
    const rows = data || [];
    document.getElementById('cnt-presents').textContent = rows.filter(r => r.heure_arrivee && !r.heure_sortie).length;
    document.getElementById('cnt-sorties').textContent  = rows.filter(r => r.heure_sortie).length;
    document.getElementById('cnt-retards').textContent  = rows.filter(r => r.statut === 'retard').length;
  } catch(e) {}
}

// ══════════════════════════════════════════════════════════════════════
//  CACHE LOCAL (mode hors-ligne)
// ══════════════════════════════════════════════════════════════════════
function cacheEmp(emp) {
  try {
    const cache = JSON.parse(localStorage.getItem('baros_emp_cache') || '{}');
    cache[emp.id] = emp;
    // Indexer aussi par qr_code si présent
    if (emp.qr_code) cache[emp.qr_code] = emp;
    localStorage.setItem('baros_emp_cache', JSON.stringify(cache));
  } catch(e) {}
}

function getCachedEmp(key) {
  try {
    const cache = JSON.parse(localStorage.getItem('baros_emp_cache') || '{}');
    const raw = key.trim();

    // Si c'est un JSON BarOS, extraire l'employee_id
    if (raw.startsWith('{')) {
      try {
        const obj = JSON.parse(raw);
        const empId = obj.employee_id || obj.id || null;
        if (empId && cache[empId]) return cache[empId];
      } catch(e) {}
    }

    // UUID direct
    if (cache[raw]) return cache[raw];

    // Sans préfixe
    const noPrefix = raw.startsWith('BAROS-EMP-') ? raw.replace('BAROS-EMP-', '')
                   : raw.startsWith('EMP-')        ? raw.replace('EMP-', '')
                   : null;
    if (noPrefix && cache[noPrefix]) return cache[noPrefix];

    return null;
  } catch(e) { return null; }
}

function storeOffline(record, action) {
  try {
    const queue = JSON.parse(localStorage.getItem('baros_offline_pointages') || '[]');
    queue.push({ ...record, action, ts: Date.now() });
    localStorage.setItem('baros_offline_pointages', JSON.stringify(queue));
    updateOfflineBadge();
  } catch(e) {}
}

function getOfflinePointage(empId, date) {
  try {
    const queue = JSON.parse(localStorage.getItem('baros_offline_pointages') || '[]');
    return queue.find(r => r.employe_id === empId && r.date_pointage === date) || null;
  } catch(e) { return null; }
}

function updateOfflineBadge() {
  try {
    const queue = JSON.parse(localStorage.getItem('baros_offline_pointages') || '[]');
    const badge = document.getElementById('sync-badge');
    if (queue.length > 0) {
      badge.style.display = 'block';
      document.getElementById('sync-count').textContent = queue.length;
    } else {
      badge.style.display = 'none';
    }
  } catch(e) {}
}

async function syncOffline() {
  if (!navigator.onLine || !db) return;
  try {
    const queue = JSON.parse(localStorage.getItem('baros_offline_pointages') || '[]');
    if (!queue.length) return;

    let synced = 0;
    const remaining = [];

    for (const item of queue) {
      try {
        if (item.action === 'arrivee') {
          await db.from('pointages').upsert({
            employe_id: item.employe_id, etab_id: item.etab_id,
            date_pointage: item.date_pointage, heure_arrivee: item.heure_arrivee, statut: item.statut,
          }, { onConflict: 'employe_id,date_pointage' });
        } else {
          await db.from('pointages')
            .update({ heure_sortie: item.heure_sortie })
            .eq('employe_id', item.employe_id)
            .eq('date_pointage', item.date_pointage);
        }
        synced++;
      } catch(e) { remaining.push(item); }
    }

    localStorage.setItem('baros_offline_pointages', JSON.stringify(remaining));
    updateOfflineBadge();

    if (synced > 0) {
      await refreshCounters();
      const bar = document.getElementById('offline-bar');
      bar.style.background = 'var(--gn)';
      bar.style.display    = 'block';
      bar.textContent      = `✅ ${synced} pointage(s) synchronisé(s)`;
      setTimeout(() => { bar.style.display = 'none'; bar.style.background = ''; }, 2500);
    }
  } catch(e) {}
}

// ══════════════════════════════════════════════════════════════════════
//  ERREURS
// ══════════════════════════════════════════════════════════════════════
function showErrCard(title, msg) {
  document.getElementById('err-title').textContent = title;
  document.getElementById('err-msg').textContent   = msg;
  document.getElementById('err-card').style.display = 'flex';
  setTimeout(closeErr, 5000);
}
function showErr(title, msg) { showErrCard(title, msg); }
function closeErr() {
  document.getElementById('err-card').style.display = 'none';
  if (scanCooldown) setTimeout(() => { scanCooldown = false; _scanPaused = false; }, 500);
}

// ══════════════════════════════════════════════════════════════════════
//  SCANNER SETUP — Réutilise sharedStream
// ══════════════════════════════════════════════════════════════════════
let _setupRafId = null;
const _setupCanvas = document.createElement('canvas');
const _setupCtx    = _setupCanvas.getContext('2d', { willReadFrequently: true });

function startSetupScanner() {
  if (!sharedStream) return;
  const container = document.getElementById('setup-qr-reader');
  if (!container) return;

  const video = document.createElement('video');
  video.setAttribute('autoplay', ''); video.setAttribute('muted', ''); video.setAttribute('playsinline', '');
  video.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:8px;display:block;';
  container.appendChild(video);
  video.srcObject = sharedStream;
  video.play();

  _setupRafId = 0;
  (function tick() {
    if (_setupRafId === null) return;
    if (video.readyState >= video.HAVE_ENOUGH_DATA) {
      _setupCanvas.width  = video.videoWidth;
      _setupCanvas.height = video.videoHeight;
      _setupCtx.drawImage(video, 0, 0);
      const img  = _setupCtx.getImageData(0, 0, _setupCanvas.width, _setupCanvas.height);
      const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
      if (code) { onSetupQrScan(code.data); return; }
    }
    _setupRafId = requestAnimationFrame(tick);
  })();
}

function stopSetupScanner() {
  if (_setupRafId) cancelAnimationFrame(_setupRafId);
  _setupRafId = null;
}

function onSetupQrScan(text) {
  try {
    const payload = JSON.parse(text);
    if (payload.t !== 'baros-cfg') return;
    stopSetupScanner();
    const cfg = { url: payload.u, key: payload.k, etab_id: payload.e };
    localStorage.setItem('baros_pointage_cfg', JSON.stringify(cfg));
    document.getElementById('setup-card').style.display = 'none';
    if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
    startApp(cfg);
  } catch(e) {}
}

function saveSetup() {
  const url  = document.getElementById('cfg-url').value.trim();
  const key  = document.getElementById('cfg-key').value.trim();
  const etab = document.getElementById('cfg-etab').value.trim();
  document.getElementById('setup-error').style.display = 'none';
  if (!url)  { _setupErr('⚠️ URL Supabase manquante'); return; }
  if (!key)  { _setupErr('⚠️ Clé API manquante'); return; }
  if (!etab) { _setupErr('⚠️ ID établissement manquant'); return; }
  const btn = document.getElementById('btn-setup-save');
  btn.textContent = '⏳ Connexion en cours…'; btn.disabled = true; btn.style.opacity = '0.7';
  stopSetupScanner();
  const cfg = { url, key, etab_id: etab };
  localStorage.setItem('baros_pointage_cfg', JSON.stringify(cfg));
  document.getElementById('setup-card').style.display = 'none';
  startApp(cfg);
}

function _setupErr(msg) {
  const el = document.getElementById('setup-error');
  el.textContent = msg;
  el.style.display = 'block';
}

// ══════════════════════════════════════════════════════════════════════
//  PRE-CHARGEMENT CACHE EMPLOYES — Offline-first complet
//  Charge TOUS les employes actifs en localStorage au demarrage.
// ══════════════════════════════════════════════════════════════════════
async function preloadEmployeCache() {
  if (!navigator.onLine || !db || !ETAB_ID) return 0;
  try {
    const { data, error } = await db
      .from('employes')
      .select('id,nom,role,photo,plages_horaires,actif,pin,qr_code,etab_id')
      .eq('etab_id', ETAB_ID);
    if (error || !data || !data.length) return 0;
    const cache = {};
    try { Object.assign(cache, JSON.parse(localStorage.getItem('baros_emp_cache') || '{}')); } catch(e) {}
    let count = 0;
    for (const raw of data) {
      const emp = _normalizeEmp(raw);
      if (!emp) continue;
      cache[emp.id] = emp;
      count++;
    }
    localStorage.setItem('baros_emp_cache', JSON.stringify(cache));
    localStorage.setItem('baros_emp_cache_ts', Date.now().toString());
    console.log('[BarOS] Cache: ' + count + ' employes charges');
    return count;
  } catch(e) {
    console.warn('[BarOS] preloadEmployeCache erreur:', e);
    return 0;
  }
}

function _startCacheRefreshLoop() {
  setInterval(function() {
    if (navigator.onLine && db) preloadEmployeCache();
  }, 10 * 60 * 1000);
}

// ══════════════════════════════════════════════════════════════════════
//  DEMARRAGE APPLICATION
// ══════════════════════════════════════════════════════════════════════
async function startApp(cfg) {
  const { createClient } = supabase;
  db      = createClient(cfg.url, cfg.key);
  ETAB_ID = cfg.etab_id;

  try {
    const { data } = await db.from('etabs').select('nom').eq('id', ETAB_ID).single();
    ETAB_NOM = data?.nom || 'BarOS';
  } catch(e) { ETAB_NOM = 'BarOS'; }
  document.getElementById('hdr-etab').textContent = ETAB_NOM + ' — Pointage';

  startScanner();
  updateOfflineBadge();
  refreshCounters();

  var cacheTs = parseInt(localStorage.getItem('baros_emp_cache_ts') || '0');
  var cacheAge = Date.now() - cacheTs;
  var CACHE_TTL = 15 * 60 * 1000;

  if (cacheAge > CACHE_TTL || cacheTs === 0) {
    preloadEmployeCache().then(function(n) {
      if (n > 0) {
        var bar = document.getElementById('offline-bar');
        if (bar.style.display !== 'block') {
          bar.style.background = '#4ade80';
          bar.style.color = '#0a0a0f';
          bar.style.display = 'block';
          bar.textContent = '✅ ' + n + ' employes charges — mode hors-ligne pret';
          setTimeout(function() {
            bar.style.display = 'none';
            bar.style.background = '';
            bar.style.color = '';
          }, 3500);
        }
      }
    });
  }

  window.addEventListener('online', function() { preloadEmployeCache(); });
  _startCacheRefreshLoop();
}

// ══════════════════════════════════════════════════════════════════════
//  INIT — Point d'entrée principal
// ══════════════════════════════════════════════════════════════════════
(function init() {
  updateClock();
  setInterval(updateClock, 10000);

  window.addEventListener('online',  () => { document.getElementById('offline-bar').style.display='none'; syncOffline(); });
  window.addEventListener('offline', () => { document.getElementById('offline-bar').style.display='block'; });
  if (!navigator.onLine) document.getElementById('offline-bar').style.display = 'block';

  function _showCameraError(msg) {
    let bar = document.getElementById('camera-error-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'camera-error-bar';
      bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#c0392b;color:#fff;font-size:13px;padding:10px 16px;text-align:center;line-height:1.4;cursor:pointer';
      bar.onclick = () => bar.remove();
      document.body.appendChild(bar);
    }
    bar.innerHTML = '📷 Caméra bloquée — ' + msg +
      '<br><small>Cliquez ici pour fermer. Assurez-vous d\'utiliser HTTPS.</small>';
  }

  async function _doGetUserMedia(cfg) {
    if (!navigator.mediaDevices?.getUserMedia) {
      _showCameraError('navigator.mediaDevices indisponible');
      _continueWithoutCamera(cfg);
      return;
    }
    const constraints = await _selectBestCamera();
    for (const c of constraints) {
      try {
        sharedStream = await navigator.mediaDevices.getUserMedia(c);
        if (cfg) startApp(cfg); else startSetupScanner();
        return;
      } catch(e) {}
    }
    _showCameraError('Aucune caméra accessible');
    _continueWithoutCamera(cfg);
  }

  function _continueWithoutCamera(cfg) {
    if (cfg) {
      document.getElementById('setup-card').style.display = 'none';
      startApp(cfg);
    } else {
      document.getElementById('cfg-url').value = SB_URL_DEFAULT;
      document.getElementById('cfg-key').value = SB_KEY_DEFAULT;
      document.getElementById('setup-card').style.display = 'flex';
      const z = document.getElementById('setup-scan-zone');
      if (z) z.style.display = 'none';
    }
  }

  const cfg = JSON.parse(localStorage.getItem('baros_pointage_cfg') || 'null');

  if (cfg && cfg.url && cfg.key && cfg.etab_id) {
    // Config existante → overlay de démarrage
    document.getElementById('setup-card').style.display = 'none';
    document.body.insertAdjacentHTML('afterbegin',
      '<div id="cam-start-overlay" style="position:fixed;inset:0;background:#0a0a0f;z-index:9998;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;padding:32px">' +
      '<div style="font-size:56px">📷</div>' +
      '<div style="font-family:Syne,sans-serif;color:#c8f55a;font-size:22px;font-weight:800;">BarOS Pointage</div>' +
      '<div style="font-size:13px;color:rgba(240,239,245,.5);text-align:center">Moteur HyperScan v9 · Multi-engine · Android optimisé</div>' +
      '<button id="btn-start-cam" style="background:#c8f55a;color:#0a0a0f;border:none;border-radius:14px;padding:18px 48px;font-size:17px;font-weight:700;cursor:pointer;box-shadow:0 4px 32px rgba(200,245,90,.35)">' +
      '▶ Démarrer le scanner' +
      '</button></div>'
    );
    document.getElementById('btn-start-cam').addEventListener('click', function() {
      document.getElementById('cam-start-overlay').remove();
      _doGetUserMedia(cfg);
    });
  } else {
    // Première config
    document.getElementById('cfg-url').value = SB_URL_DEFAULT;
    document.getElementById('cfg-key').value = SB_KEY_DEFAULT;
    document.getElementById('setup-card').style.display = 'flex';
    const scanZone = document.getElementById('setup-scan-zone');
    if (scanZone) {
      scanZone.innerHTML =
        '<div style="text-align:center;padding:16px 0">' +
        '<button id="btn-cam" style="background:#c8f55a;color:#000;border:none;border-radius:12px;padding:16px 32px;font-size:16px;font-weight:700;cursor:pointer;width:100%">' +
        '📷 Appuyez pour activer la caméra et scanner le QR de config' +
        '</button></div>';
      document.getElementById('btn-cam').addEventListener('click', function() {
        _doGetUserMedia(null);
      });
    }
  }
})();
