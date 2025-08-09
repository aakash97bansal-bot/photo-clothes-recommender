// Milestone B: image preview + TinyFaceDetector with robust model loading
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

  // --- state ---
  let tinyModelReady = false;
  let lastDetection = null;

  // --- helpers ---
  function resizeOverlayToImage() {
    overlay.width  = frameEl.clientWidth;
    overlay.height = frameEl.clientHeight;
  }

  function drawBox(detection) {
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (!detection) return;
    const { x, y, width, height } = detection.box;
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#4da3ff';
    ctx.strokeRect(x, y, width, height);
  }

  async function loadTinyModelWithDiagnostics(statusEl) {
    // Try common base paths, in order
    const bases = ['./models', '/models', 'models'];
    const manifest = 'tiny_face_detector_model-weights_manifest.json';

    let lastErr = null;
    for (const base of bases) {
      try {
        const testUrl = new URL(`${base.replace(/\/+$/,'/')}${manifest}`, location.href).href;
        console.log('🔎 Testing model manifest URL:', testUrl);
        statusEl.textContent = `Loading face models from ${base} …`;
        const res = await fetch(testUrl, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status} on ${testUrl}`);

        // If manifest reachable, let face-api load from that base
        await faceapi.nets.tinyFaceDetector.loadFromUri(base);
        console.log('✅ Loaded TinyFaceDetector from', base);
        statusEl.textContent = `Models loaded from ${base}. Select a photo.`;
        tinyModelReady = true;
        return base;
      } catch (e) {
        console.warn('❌ Failed at base', base, e);
        lastErr = e;
      }
    }
    statusEl.textContent = 'Failed to load models. Ensure a ./models folder (json + bin) exists next to index.html.';
    throw lastErr || new Error('Model load failed on all paths');
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
      inputSize: 256,
      scoreThreshold: 0.5
    });

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
      notesValue.textContent = 'No face detected — ensure good lighting and a front-facing photo.';
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
    notesValue.textContent = 'Primary face detected. Age/gender and skin analysis will be added next.';
  }

  // --- attach preview handler immediately (so preview works even if models fail) ---
  photoInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    previewImg.src = url;
    previewImg.style.display = 'block';
    placeholder.style.display = 'none';

    previewImg.onload = () => {
      URL.revokeObjectURL(url);
      runDetection(); // will detect if models ready, else show “loading” status
    };
  });

  // --- kick off model load in the background ---
  try {
    if (typeof faceapi === 'undefined') {
      detectStatus.textContent = 'face-api.js not loaded. Ensure the script tag is included before app.js with defer.';
      console.error('faceapi is undefined. Add: <script defer src="https://cdn.jsdelivr.net/npm/face-api.js"></script> before app.js');
      return;
    }
    await loadTinyModelWithDiagnostics(detectStatus);
    // If an image is already displayed (user was fast), try detection now
    if (previewImg.complete && previewImg.naturalWidth > 0) {
      await runDetection();
    }
  } catch (e) {
    console.error(e);
    // Leave preview working; detection will be disabled via status text
  }

  // Keep overlay aligned on resize
  window.addEventListener('resize', () => {
    if (!previewImg.src) return;
    resizeOverlayToImage();
    drawBox(lastDetection);
  });
});
