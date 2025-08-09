// Milestone C: preview + TinyFaceDetector + Landmarks68 + AgeGender (with local→remote fallback)
document.addEventListener('DOMContentLoaded', async () => {
  const photoInput   = document.getElementById('photoInput');
  const previewImg   = document.getElementById('previewImg');
  const placeholder  = document.getElementById('placeholder');
  const overlay      = document.getElementById('overlay');
  const detectStatus = document.getElementById('detectStatus');
  const notesValue   = document.getElementById('notesValue');
  const frameEl      = document.getElementById('imageFrame');

  const ageEl        = document.getElementById('ageValue');
  const genderEl     = document.getElementById('genderValue');

  if (!photoInput || !previewImg || !overlay || !detectStatus || !frameEl) {
    console.error('Missing expected DOM elements. Check IDs in index.html.');
    return;
  }

  // ---- state ----
  let tinyReady = false;
  let lmkReady  = false;
  let agReady   = false;
  let lastDetection = null;

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
  function options() {
    return new faceapi.TinyFaceDetectorOptions({ inputSize: 256, scoreThreshold: 0.5 });
  }

  async function loadNetWithFallback(netLoader, localBase, remoteBase, manifestFile, label) {
    // Try LOCAL first
    try {
      const manifestUrl = new URL(manifestFile, localBase).href;
      console.log(`🔎 ${label} LOCAL manifest:`, manifestUrl);
      const res = await fetch(manifestUrl, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status} on ${manifestUrl}`);
      await netLoader(localBase);
      console.log(`✅ ${label} loaded from LOCAL`);
      return 'local';
    } catch (err) {
      console.warn(`${label} local failed, falling back → REMOTE`, err);
    }
    // Remote fallback
    const remoteManifest = new URL(manifestFile, remoteBase).href;
    console.log(`🔎 ${label} REMOTE manifest:`, remoteManifest);
    const res2 = await fetch(remoteManifest, { cache: 'no-store' });
    if (!res2.ok) throw new Error(`HTTP ${res2.status} on ${remoteManifest}`);
    await netLoader(remoteBase);
    console.log(`✅ ${label} loaded from REMOTE`);
    return 'remote';
  }

  async function loadAllModels() {
    if (typeof faceapi === 'undefined') {
      detectStatus.textContent = 'face-api.js not found. Ensure UMD script loads before app.js';
      console.error('faceapi undefined');
      return;
    }

    const LOCAL   = new URL('models/', location.href).href; // your repo /models/
    const REM_TFD = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js-models/master/tiny_face_detector/';
    const REM_LMK = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js-models/master/face_landmark_68/';
    const REM_AG  = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js-models/master/age_gender_model/';

    detectStatus.textContent = 'Loading face models…';

    // 1) TinyFaceDetector
    await loadNetWithFallback(
      base => faceapi.nets.tinyFaceDetector.loadFromUri(base),
      LOCAL, REM_TFD,
      'tiny_face_detector_model-weights_manifest.json',
      'TinyFaceDetector'
    );
    tinyReady = true;

    // 2) Landmarks 68
    await loadNetWithFallback(
      base => faceapi.nets.faceLandmark68Net.loadFromUri(base),
      LOCAL, REM_LMK,
      'face_landmark_68_model-weights_manifest.json',
      'Landmarks68'
    );
    lmkReady = true;

    // 3) Age & Gender
    await loadNetWithFallback(
      base => faceapi.nets.ageGenderNet.loadFromUri(base),
      LOCAL, REM_AG,
      'age_gender_model-weights_manifest.json',
      'AgeGender'
    );
    agReady = true;

    detectStatus.textContent = 'Models loaded. Select a photo.';
  }

  async function detectPrimaryFace() {
    resizeOverlayToImage();
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    detectStatus.textContent = 'Detecting face…';

    const dets = await faceapi.detectAllFaces(previewImg, options());
    if (!dets.length) {
      detectStatus.textContent = 'No face found. Try a clearer, frontal photo.';
      notesValue.textContent   = 'No face detected — ensure good lighting and a front-facing photo.';
      lastDetection = null;
      drawBox(null);
      return null;
    }
    const primary = dets.reduce((max, d) => {
      const a = d.box.width * d.box.height;
      const b = max.box.width * max.box.height;
      return a > b ? d : max;
    });
    drawBox(primary);
    lastDetection = primary;

    detectStatus.textContent = `Face detected ✓ (score ${(primary.score * 100).toFixed(0)}%)`;
    notesValue.textContent   = 'Primary face detected.';
    return primary;
  }

  async function detectAgeGender() {
    if (!agReady) {
      detectStatus.textContent = 'Models still loading…';
      return;
    }
    detectStatus.textContent = 'Estimating age & gender…';
    const result = await faceapi
      .detectSingleFace(previewImg, options())
      .withFaceLandmarks()
      .withAgeAndGender();

    if (!result) {
      detectStatus.textContent = 'Could not estimate age/gender. Try a clearer face.';
      return;
    }

    const age = Math.round(result.age || 0);
    const gender = result.gender || 'unknown';
    const conf = result.genderProbability ? (result.genderProbability * 100).toFixed(1) : '—';

    ageEl.textContent = `${age}`;
    genderEl.textContent = `${gender} (${conf}%)`;

    notesValue.textContent = 'Age & gender are approximate.';
  }

  async function runPipeline() {
    if (!tinyReady) {
      detectStatus.textContent = 'Models still loading… Preview works; detection will start when ready.';
      return;
    }
    const primary = await detectPrimaryFace();
    if (!primary) return;

    // Age + Gender
    await detectAgeGender();
  }

  // preview first (works even if models fail)
  photoInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    previewImg.src = url;
    previewImg.style.display = 'block';
    placeholder.style.display = 'none';

    previewImg.onload = () => {
      URL.revokeObjectURL(url);
      runPipeline();
    };
  });

  // start loading models (don’t block preview)
  try {
    await loadAllModels();
    if (previewImg.complete && previewImg.naturalWidth > 0) {
      await runPipeline();
    }
  } catch (e) {
    console.error('Model load failed:', e);
    detectStatus.textContent = 'Failed to load models. See console for details.';
  }

  // keep overlay aligned on resize
  window.addEventListener('resize', () => {
    if (!previewImg.src) return;
    resizeOverlayToImage();
    drawBox(lastDetection);
  });
});
