// Milestones B+C+D: preview + TinyFaceDetector + Landmarks68 + AgeGender + Skin tone/undertone
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
  const swatchEl     = document.getElementById('skinSwatch');
  const skinHexEl    = document.getElementById('skinHex');
  const toneEl       = document.getElementById('toneValue');
  const undertoneEl  = document.getElementById('undertoneValue');

  if (!photoInput || !previewImg || !overlay || !detectStatus || !frameEl) {
    console.error('Missing expected DOM elements. Check IDs in index.html.');
    return;
  }

  // ---- state ----
  let tinyReady = false;
  let lmkReady  = false;
  let agReady   = false;
  let lastDetection = null;

  // ---- helpers (UI) ----
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

  // ---- model loaders (local → remote fallback) ----
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

  // ---- color utils ----
  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
  function rgbToHex(r,g,b){
    const h = (x) => x.toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
  }
  function srgbToLinear(c){ // c: 0–1
    return (c <= 0.04045) ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4);
  }
  function relativeLuminance(r,g,b){ // r,g,b: 0–255
    const rl = srgbToLinear(r/255), gl = srgbToLinear(g/255), bl = srgbToLinear(b/255);
    return 0.2126*rl + 0.7152*gl + 0.0722*bl; // 0–1
  }
  function rgbToHsl(r, g, b) { // 0–255
    r/=255; g/=255; b/=255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b);
    let h, s, l = (max+min)/2;
    if (max===min) { h=0; s=0; }
    else {
      const d = max-min;
      s = l > .5 ? d/(2-max-min) : d/(max+min);
      switch(max){
        case r: h = (g-b)/d + (g < b ? 6 : 5); break; // bias toward warm hues for skin
        case g: h = (b-r)/d + 3; break;
        case b: h = (r-g)/d + 1; break;
      }
      h /= 6;
    }
    return { h: h*360, s, l };
  }

  // ---- cheek sampling (uses face box; works in displayed coords) ----
  function cheekRectsFromBox(box){
    // Rects as fractions of the face box (tuned to avoid eyes/lips)
    const lw = box.width, lh = box.height;
    const left  = {
      x: box.x + lw*0.18,
      y: box.y + lh*0.44,
      w: lw*0.16,
      h: lh*0.12
    };
    const right = {
      x: box.x + lw*0.66,
      y: box.y + lh*0.44,
      w: lw*0.16,
      h: lh*0.12
    };
    return [left, right];
  }
  function sampleAverageRGB(ctx, rect){
    const x = Math.round(rect.x), y = Math.round(rect.y);
    const w = Math.max(1, Math.round(rect.w)), h = Math.max(1, Math.round(rect.h));
    const data = ctx.getImageData(x,y,w,h).data;
    let r=0,g=0,b=0,count=0;
    for (let i=0;i<data.length;i+=4){
      const R=data[i], G=data[i+1], B=data[i+2], A=data[i+3];
      if (A<200) continue; // ignore transparent pixels
      // basic filtering to avoid lips/eyes/shadows: clamp on saturation & lightness
      const { s, l } = rgbToHsl(R,G,B);
      if (s>0.6 || l<0.15 || l>0.95) continue;
      r+=R; g+=G; b+=B; count++;
    }
    if (count===0) return null;
    return { r: Math.round(r/count), g: Math.round(g/count), b: Math.round(b/count) };
  }
  function analyzeSkin(previewImg, faceBox){
    // Draw displayed image into a scratch canvas same size as overlay
    const w = frameEl.clientWidth, h = frameEl.clientHeight;
    const cnv = document.createElement('canvas');
    cnv.width = w; cnv.height = h;
    const ctx = cnv.getContext('2d');
    ctx.drawImage(previewImg, 0, 0, w, h);

    const [L, R] = cheekRectsFromBox(faceBox);
    const c1 = sampleAverageRGB(ctx, L);
    const c2 = sampleAverageRGB(ctx, R);

    let rgb;
    if (c1 && c2) rgb = { r: Math.round((c1.r+c2.r)/2), g: Math.round((c1.g+c2.g)/2), b: Math.round((c1.b+c2.b)/2) };
    else rgb = c1 || c2 || { r: 180, g: 140, b: 120 }; // safe fallback

    const hex = rgbToHex(rgb.r, rgb.g, rgb.b);

    // tone bucket by relative luminance
    const Y = relativeLuminance(rgb.r, rgb.g, rgb.b); // 0–1
    const tone = Y >= 0.70 ? 'light' : (Y >= 0.45 ? 'medium' : 'deep');

    // undertone heuristic (warm if R >> B; cool if B >> R; else neutral)
    const diffRB = (rgb.r - rgb.b) / 255;
    const diffBR = (rgb.b - rgb.r) / 255;
    let undertone = 'neutral';
    if (diffRB > 0.12 && rgb.g >= rgb.b) undertone = 'warm';
    else if (diffBR > 0.10) undertone = 'cool';

    return { rgb, hex, tone, undertone };
  }

  // ---- pipeline steps ----
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
    return primary;
  }

  async function detectAgeGenderAndSkin(faceBox) {
    if (!agReady || !lmkReady) {
      detectStatus.textContent = 'Models still loading…';
      return;
    }

    detectStatus.textContent = 'Estimating age, gender & skin…';
    const result = await faceapi
      .detectSingleFace(previewImg, options())
      .withFaceLandmarks()
      .withAgeAndGender();

    if (!result) {
      detectStatus.textContent = 'Could not estimate age/gender. Try a clearer face.';
      notesValue.textContent   = 'Analysis failed — try a well-lit, front-facing photo.';
      return;
    }

    // Age & Gender
    const age = Math.round(result.age || 0);
    const gender = result.gender || 'unknown';
    const conf = result.genderProbability ? (result.genderProbability * 100).toFixed(1) : '—';
    ageEl.textContent    = `${age}`;
    genderEl.textContent = `${gender} (${conf}%)`;

    // Skin swatch / tone / undertone (cheeks sampling)
    const skin = analyzeSkin(previewImg, faceBox || result.detection.box);
    swatchEl.style.background = skin.hex;
    skinHexEl.textContent     = skin.hex;
    toneEl.textContent        = skin.tone;
    undertoneEl.textContent   = skin.undertone;

    notesValue.textContent = 'Values are approximate. If lighting is uneven, try another photo.';
    detectStatus.textContent = 'Analysis complete.';
  }

  async function runPipeline() {
    if (!tinyReady) {
      detectStatus.textContent = 'Models still loading… Preview works; detection will start when ready.';
      return;
    }
    const primary = await detectPrimaryFace();
    if (!primary) return;

    await detectAgeGenderAndSkin(primary.box);
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
      runPipeline();
    };
  });

  // ---- start loading models (don’t block preview) ----
  try {
    await loadAllModels();
    if (previewImg.complete && previewImg.naturalWidth > 0) {
      await runPipeline();
    }
  } catch (e) {
    console.error('Model load failed:', e);
    detectStatus.textContent = 'Failed to load models. See console for details.';
  }

  // ---- keep overlay aligned on resize ----
  window.addEventListener('resize', () => {
    if (!previewImg.src) return;
    resizeOverlayToImage();
    drawBox(lastDetection);
  });
});
