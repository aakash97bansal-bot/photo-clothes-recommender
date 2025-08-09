// Milestone B: image preview + TinyFaceDetector with absolute models URL (GitHub Pages safe)
document.addEventListener('DOMContentLoaded', async () => {
  const photoInput   = document.getElementById('photoInput');
  const previewImg   = document.getElementById('previewImg');
  const placeholder  = document.getElementById('placeholder');
  const overlay      = document.getElementById('overlay');
  const detectStatus = document.getElementById('detectStatus');
  const notesValue   = document.getElementById('notesValue');
  const frameEl      = document.getElementById('imageFrame');

  let tinyModelReady = false;
  let lastDetection  = null;

  // ---- helpers ----
  function absoluteModelsBase() {
    // e.g. https://aakash97bansal-bot.github.io/photo-clothes-recommender/models/
    return new URL('models/', location.href).href;
  }
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
      console.error('faceapi is undefined');
      return;
    }

    const base = absoluteModelsBase();
    const manifest = 'tiny_face_detector_model-weights_manifest.json';
    const testUrl  = new URL(manifest, base).href;

    console.log('🔎 Trying manifest URL:', testUrl);
    statusEl.textContent = `Loading face models from ${base} …`;

    // 1) verify manifest reachable
    const res = await fetch(testUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${testUrl}`);

    // 2) load via face-api from the same absolute base
    await faceapi.nets.tinyFaceDetector.loadFromUri(base);

    tinyModelReady = true;
    statusEl.textContent = `Models loaded from ${base}. Select a photo.`;
    console.log('✅ TinyFaceDetector loaded from', base);
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

    const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 256, scoreThreshold: 0.5 });

    let detections = [];
    try {
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

  // Preview first — works even if models fail
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

  // Kick off model load (don’t block preview)
  try {
    await loadTinyModel(detectStatus);
    // If user already picked an image, detect now
    if (previewImg.complete && previewImg.naturalWidth > 0) {
      await runDetection();
    }
  } catch (e) {
    console.error('Model load failed:', e);
    detectStatus.textContent = 'Failed to load models. Click the manifest URL in Console to debug.';
  }

  // Keep overlay aligned
  window.addEventListener('resize', () => {
    if (!previewImg.src) return;
    resizeOverlayToImage();
    drawBox(lastDetection);
  });
});
