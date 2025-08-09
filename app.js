// Milestone B: image preview + TinyFaceDetector with local → remote fallback
document.addEventListener('DOMContentLoaded', async () => {
  const photoInput   = document.getElementById('photoInput');
  const previewImg   = document.getElementById('previewImg');
  const placeholder  = document.getElementById('placeholder');
  const overlay      = document.getElementById('overlay');
  const detectStatus = document.getElementById('detectStatus');
  const notesValue   = document.getElementById('notesValue');
  const frameEl      = document.getElementById('imageFrame');

  if (!photoInput || !previewImg || !overlay || !detectStatus || !frameEl) {
    console.error('Missing expected DOM elements. Check IDs in index.html.');
    return;
  }

  // ---- state ----
  let tinyModelReady = false;
  let lastDetection  = null;

  // ---- helpers ----
  function resizeOverlayToImage() {
    overlay.width  = frameEl.clientWidth;
    overlay.height = frameEl.clientHeight;
  }

  function drawBox(det) {
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (!det) return;
    const { x, y, width, height } = det.box;
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#4da3ff';
    ctx.strokeRect(x, y, width, height);
  }

  async function loadTinyModel(statusEl) {
    if (typeof faceapi === 'undefined') {
      statusEl.textContent = 'face-api.js not found. Ensure the CDN script tag loads before app.js';
      console.error('faceapi is undefined. Add the UMD build before app.js: https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js');
      return;
    }

    const LOCAL  = new URL('models/', location.href).href; // e.g. https://.../photo-clothes-recommender/models/
    const REMOTE = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js-models/master/tiny_face_detector/';

    // 1) Try LOCAL first (preflight the manifest so we fail fast if wrong)
    try {
      const manifest = new URL('tiny_face_detector_model-weights_manifest.json', LOCAL).href;
      console.log('🔎 Trying LOCAL manifest URL:', manifest);
      statusEl.textContent = `Loading face models from ${LOCAL} …`;

      const res = await fetch(manifest, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status} on ${manifest}`);

      await faceapi.nets.tinyFaceDetector.loadFromUri(LOCAL);
      tinyModelReady = true;
      statusEl.textContent = 'Models loaded from local /models/. Select a photo.';
      console.log('✅ TinyFaceDetector loaded from LOCAL');
      return 'local';
    } catch (err) {
      console.warn('Local tiny model failed, falling back to REMOTE…', err);
    }

    // 2) Fallback: REMOTE (official host)
    const remoteManifest = new URL('tiny_face_detector_model-weights_manifest.json', REMOTE).href;
    console.log('🔎 Trying REMOTE manifest URL:', remoteManifest);
    statusEl.textContent = 'Loading face models from remote host…';

    const r = await fetch(remoteManifest, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status} on ${remoteManifest}`);

    await faceapi.nets.tinyFaceDetector.loadFromUri(REMOTE);
    tinyModelReady = true;
    statusEl.textContent = 'Models loaded from remote host. Select a photo.';
    console.log('✅ TinyFaceDetector loaded from REMOTE');
    return 'remote';
  }

  async function runDetection() {
    if (!tinyModelReady) {
      detectStatus.textContent = 'Models still loading… Preview works; detection will start when ready.';
      return;
    }
    if (!previewImg.src) return;

    resizeOverlayToImage();
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    detectStatus.textContent = 'Detecting face…';

    const options = new faceapi.TinyFaceDetectorOptions({
      inputSize: 256,      // speed/accuracy tradeoff: 160–416
      scoreThreshold: 0.5
    });

    let detections = [];
    try {
      // Passing the <img> element yields boxes in displayed coords
      detections = await faceapi.detectAllFaces(previewImg, options);
    } catch (err) {
      console.error('Detection error:', err);
      detectStatus.textContent = 'Detection error. See console.';
      notesValue.textContent = 'An error occurred during detection. Try another image.';
      return;
    }

    if (!detections.length) {
      detectStatus.textContent = 'No face found. Try a clearer, frontal photo.';
      notesValue.textContent   = 'No face detected — ensure good lighting and a front-facing photo.';
      lastDetection = null;
      drawBox(null);
      return;
    }

    const primary = detections.reduce((max, d) => {
      const a = d.box.width * d.box.height;
      const b = max.box.width * max.box.height;
      return a > b ? d : max;
    });

    drawBox(primary);
    lastDetection = primary;
    detectStatus.textContent = `Face detected ✓ (score ${(primary.score * 100).toFixed(0)}%)`;
    notesValue.textContent   = 'Primary face detected. Age/gender and skin analysis will be added next.';
  }

  // ---- preview first (works even if models fail) ----
  photoInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    previewImg.src = url;
    previewImg.style.display = 'block';
    placeholder.style.display = 'none';

    previewImg.onload = () => {
      URL.revokeObjectURL(url);
      runDetection();
    };
  });

  // ---- kick off model load (don’t block preview) ----
  try {
    await loadTinyModel(detectStatus);
    if (previewImg.complete && previewImg.naturalWidth > 0) {
      await runDetection();
    }
  } catch (e) {
    console.error('Model load failed:', e);
    detectStatus.textContent = 'Failed to load models. See console for the manifest URL.';
  }

  // ---- keep overlay aligned on resize ----
  window.addEventListener('resize', () => {
    if (!previewImg.src) return;
    resizeOverlayToImage();
    drawBox(lastDetection);
  });
});
