// Milestones B+C+D+E/F: detection + analysis + "Get Suggestions" (LLM proxy backend)
document.addEventListener('DOMContentLoaded', async () => {
  // ---- DOM ----
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

  const seasonSelect = document.getElementById('seasonSelect');
  const getBtn       = document.getElementById('getSuggestionsBtn');
  const snippetEl    = document.getElementById('snippet');

  // ---- config: set your API base here after deploying the function ----
  // e.g. "https://your-vercel-project.vercel.app"
  const API_BASE = ""; // leave empty for now; fill in after step 2 below
  const API_RECOMMEND = () => `${API_BASE}/api/recommend`;

  // ---- state ----
  let tinyReady = false, lmkReady = false, agReady = false;
  let lastDetection = null;
  let analysis = null; // will hold { age, gender, genderProb, skin:{hex,tone,undertone} }

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

    await loadNetWithFallback(
      base => faceapi.nets.tinyFaceDetector.loadFromUri(base),
      LOCAL, REM_TFD, 'tiny_face_detector_model-weights_manifest.json', 'TinyFaceDetector'
    ); tinyReady = true;

    await loadNetWithFallback(
      base => faceapi.nets.faceLandmark68Net.loadFromUri(base),
      LOCAL, REM_LMK, 'face_landmark_68_model-weights_manifest.json', 'Landmarks68'
    ); lmkReady = true;

    await loadNetWithFallback(
      base => faceapi.nets.ageGenderNet.loadFromUri(base),
      LOCAL, REM_AG, 'age_gender_model-weights_manifest.json', 'AgeGender'
    ); agReady = true;

    detectStatus.textContent = 'Models loaded. Select a photo.';
  }

  // ---- color utils ----
  function rgbToHex(r,g,b){ const h=x=>x.toString(16).padStart(2,'0'); return `#${h(r)}${h(g)}${h(b)}`.toUpperCase(); }
  function srgbToLinear(c){ return (c<=0.04045)? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); }
  function relativeLuminance(r,g,b){ const rl=srgbToLinear(r/255), gl=srgbToLinear(g/255), bl=srgbToLinear(b/255); return 0.2126*rl+0.7152*gl+0.0722*bl; }

  // ---- cheek sampling ----
  function cheekRectsFromBox(box){
    const lw=box.width, lh=box.height;
    return [
      { x: box.x + lw*0.18, y: box.y + lh*0.44, w: lw*0.16, h: lh*0.12 },
      { x: box.x + lw*0.66, y: box.y + lh*0.44, w: lw*0.16, h: lh*0.12 }
    ];
  }
  function sampleAverageRGB(ctx, rect){
    const x=Math.round(rect.x), y=Math.round(rect.y);
    const w=Math.max(1,Math.round(rect.w)), h=Math.max(1,Math.round(rect.h));
    const data=ctx.getImageData(x,y,w,h).data;
    let r=0,g=0,b=0,count=0;
    for(let i=0;i<data.length;i+=4){
      const R=data[i], G=data[i+1], B=data[i+2], A=data[i+3];
      if (A<200) continue;
      const max=Math.max(R,G,B), min=Math.min(R,G,B), l=(max+min)/510, s=max===min?0:(l>0.5?(max-min)/(510-max-min):(max-min)/(max+min));
      if (s>0.6 || l<0.15 || l>0.95) continue;
      r+=R; g+=G; b+=B; count++;
    }
    if(!count) return null;
    return { r:Math.round(r/count), g:Math.round(g/count), b:Math.round(b/count) };
  }
  function analyzeSkin(previewImg, faceBox){
    const w=frameEl.clientWidth, h=frameEl.clientHeight;
    const cnv=document.createElement('canvas'); cnv.width=w; cnv.height=h;
    const ctx=cnv.getContext('2d'); ctx.drawImage(previewImg,0,0,w,h);
    const [L,R]=cheekRectsFromBox(faceBox);
    const c1=sampleAverageRGB(ctx,L), c2=sampleAverageRGB(ctx,R);
    const rgb = c1&&c2 ? { r:Math.round((c1.r+c2.r)/2), g:Math.round((c1.g+c2.g)/2), b:Math.round((c1.b+c2.b)/2) } : (c1||c2||{r:180,g:140,b:120});
    const hex = rgbToHex(rgb.r,rgb.g,rgb.b);
    const Y = relativeLuminance(rgb.r,rgb.g,rgb.b); // 0–1
    const tone = Y>=0.70?'light':(Y>=0.45?'medium':'deep');
    const diffRB = (rgb.r-rgb.b)/255, diffBR=(rgb.b-rgb.r)/255;
    const undertone = diffRB>0.12 && rgb.g>=rgb.b ? 'warm' : (diffBR>0.10 ? 'cool' : 'neutral');
    return { rgb, hex, tone, undertone };
  }

  // ---- pipeline steps ----
  function mapToneToBucket(tone){ return tone; } // already light/medium/deep
  async function detectPrimaryFace() {
    resizeOverlayToImage();
    const ctx = overlay.getContext('2d'); ctx.clearRect(0,0,overlay.width,overlay.height);
    detectStatus.textContent = 'Detecting face…';
    const dets = await faceapi.detectAllFaces(previewImg, options());
    if (!dets.length){ detectStatus.textContent='No face found. Try a clearer, frontal photo.'; notesValue.textContent='No face detected — ensure good lighting and a front-facing photo.'; lastDetection=null; drawBox(null); return null; }
    const primary = dets.reduce((max,d)=> (d.box.width*d.box.height)>(max.box.width*max.box.height)?d:max);
    drawBox(primary); lastDetection=primary; detectStatus.textContent=`Face detected ✓ (score ${(primary.score*100).toFixed(0)}%)`;
    return primary;
  }
  async function detectAgeGenderAndSkin(faceBox) {
    if (!agReady || !lmkReady){ detectStatus.textContent='Models still loading…'; return; }
    detectStatus.textContent='Estimating age, gender & skin…';
    const result = await faceapi.detectSingleFace(previewImg, options()).withFaceLandmarks().withAgeAndGender();
    if (!result){ detectStatus.textContent='Could not estimate age/gender. Try a clearer face.'; notesValue.textContent='Analysis failed — try a well-lit, front-facing photo.'; return; }
    const age = Math.round(result.age||0);
    const gender = result.gender||'unknown';
    const genderProb = result.genderProbability||0;
    ageEl.textContent = `${age}`;
    genderEl.textContent = `${gender} ${(genderProb*100).toFixed(1)}%`;

    const skin = analyzeSkin(previewImg, faceBox||result.detection.box);
    swatchEl.style.background = skin.hex;
    skinHexEl.textContent = skin.hex;
    toneEl.textContent = skin.tone;
    undertoneEl.textContent = skin.undertone;

    analysis = {
      age, gender, genderProb,
      skin: { hex: skin.hex, tone: skin.tone, undertone: skin.undertone },
      skinToneBucket: mapToneToBucket(skin.tone)
    };

    notesValue.textContent = 'Analysis complete (approximate).';
    detectStatus.textContent = 'Ready for suggestions.';
    getBtn.disabled = false; // ✅ enable button now that we have analysis
  }
  async function runPipeline() {
    if (!tinyReady){ detectStatus.textContent='Models still loading…'; return; }
    const primary = await detectPrimaryFace(); if (!primary) return;
    await detectAgeGenderAndSkin(primary.box);
  }

  // ---- Outfit Snippet rendering ----
  function renderSnippet(s) {
    // Expecting: { headwear, top, midlayer, bottoms, footwear, accessories, palette:{primary,accent,neutral}, rationale? }
    const listHtml = `
      <ul>
        <li>Headwear: ${s.headwear || '—'}</li>
        <li>Top: ${s.top || '—'}</li>
        <li>Mid-layer: ${s.midlayer || '—'}</li>
        <li>Bottoms: ${s.bottoms || '—'}</li>
        <li>Footwear: ${s.footwear || '—'}</li>
        <li>Accessories: ${s.accessories || '—'}</li>
      </ul>
      <div class="palette">
        <div class="palette-chip" title="Primary" style="background:${s.palette?.primary || '#e8e8e8'}"></div>
        <div class="palette-chip" title="Accent"  style="background:${s.palette?.accent  || '#bdbdbd'}"></div>
        <div class="palette-chip" title="Neutral" style="background:${s.palette?.neutral || '#6b7280'}"></div>
      </div>
      ${s.rationale ? `<p class="muted" style="margin-top:8px">${s.rationale}</p>` : '' }
    `;
    snippetEl.innerHTML = listHtml;
  }
  function dummySuggestions(weather){
    const map = {
      summer: { headwear:"Straw hat (optional)", top:"Off-white linen shirt", midlayer:"None", bottoms:"Sand chino shorts", footwear:"White canvas sneakers", accessories:"Brown belt; tortoise sunglasses", palette:{primary:"#F5F1E9",accent:"#8C6239",neutral:"#3C3C3C"}, rationale:"Breathable fabrics and earthy neutrals pair well with warm undertones in high heat." },
      winter: { headwear:"Rib-knit beanie", top:"Merino turtleneck", midlayer:"Wool overcoat", bottoms:"Slim dark denim", footwear:"Brown leather boots", accessories:"Knit scarf & gloves", palette:{primary:"#2B2F36",accent:"#7A5037",neutral:"#D9D9D9"} },
      rainy:  { headwear:"Waterproof cap", top:"Lightweight rain shell", midlayer:"Cotton tee", bottoms:"Quick-dry chinos", footwear:"Waterproof sneakers", accessories:"Compact umbrella", palette:{primary:"#0E2135",accent:"#3AA6FF",neutral:"#C2C8CE"} },
      spring: { headwear:"None", top:"Chambray shirt", midlayer:"Unlined blazer", bottoms:"Khaki chinos", footwear:"White sneakers", accessories:"Leather belt", palette:{primary:"#E9EEF5",accent:"#4DA3FF",neutral:"#3C3C3C"} },
      autumn: { headwear:"Wool cap (optional)", top:"Crewneck sweater", midlayer:"Leather jacket", bottoms:"Olive chinos", footwear:"Chelsea boots", accessories:"Brown belt", palette:{primary:"#3E3A34",accent:"#C07F3A",neutral:"#D8D2C8"} }
    };
    return map[weather] || map.summer;
  }

  async function fetchSuggestions(payload) {
    if (!API_BASE) {
      console.warn('No API_BASE configured; using dummy suggestions.');
      return { ok: true, data: dummySuggestions(payload.season) };
    }
    try {
      const res = await fetch(API_RECOMMEND(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        console.warn('API returned non-200, using dummy suggestions.');
        return { ok:false, data: dummySuggestions(payload.season) };
      }
      const data = await res.json();
      return { ok:true, data };
    } catch (e) {
      console.error('API error, using dummy suggestions.', e);
      return { ok:false, data: dummySuggestions(payload.season) };
    }
  }

  // ---- events ----
  photoInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const url = URL.createObjectURL(file);
    previewImg.src = url; previewImg.style.display = 'block'; placeholder.style.display = 'none';
    previewImg.onload = () => { URL.revokeObjectURL(url); runPipeline(); };
    // Disable button until analysis completes
    getBtn.disabled = true;
  });

  getBtn.addEventListener('click', async () => {
    if (!analysis) return;
    getBtn.disabled = true;
    const season = seasonSelect.value;
    detectStatus.textContent = 'Generating outfit suggestions…';

    const payload = {
      age: analysis.age,
      gender: analysis.gender,
      genderConfidence: Number((analysis.genderProb*100).toFixed(1)),
      skinHex: analysis.skin.hex,
      skinToneBucket: analysis.skinToneBucket,  // light/medium/deep
      undertone: analysis.skin.undertone,
      season
    };

    const { data } = await fetchSuggestions(payload);
    renderSnippet(data);

    detectStatus.textContent = 'Suggestions ready.';
    getBtn.disabled = false;
  });

  // ---- start loading models (don’t block preview) ----
  try {
    await loadAllModels();
    if (previewImg.complete && previewImg.naturalWidth > 0) await runPipeline();
  } catch (e) {
    console.error('Model load failed:', e);
    detectStatus.textContent = 'Failed to load models. See console for details.';
  }

  // ---- keep overlay aligned on resize ----
  window.addEventListener('resize', () => {
    if (!previewImg.src) return; resizeOverlayToImage(); drawBox(lastDetection);
  });

  async function runPipeline(){ if (!tinyReady){ detectStatus.textContent='Models still loading…'; return; } const primary=await detectPrimaryFace(); if(!primary) return; await detectAgeGenderAndSkin(primary.box); }
  async function detectPrimaryFace(){ resizeOverlayToImage(); const ctx=overlay.getContext('2d'); ctx.clearRect(0,0,overlay.width,overlay.height); detectStatus.textContent='Detecting face…'; const dets=await faceapi.detectAllFaces(previewImg, options()); if(!dets.length){ detectStatus.textContent='No face found. Try a clearer, frontal photo.'; notesValue.textContent='No face detected — ensure good lighting and a front-facing photo.'; lastDetection=null; drawBox(null); return null; } const primary=dets.reduce((m,d)=> (d.box.width*d.box.height)>(m.box.width*m.box.height)?d:m); drawBox(primary); lastDetection=primary; detectStatus.textContent=`Face detected ✓ (score ${(primary.score*100).toFixed(0)}%)`; return primary; }
  async function detectAgeGenderAndSkin(faceBox){ if(!agReady||!lmkReady){ detectStatus.textContent='Models still loading…'; return; } detectStatus.textContent='Estimating age, gender & skin…'; const result=await faceapi.detectSingleFace(previewImg, options()).withFaceLandmarks().withAgeAndGender(); if(!result){ detectStatus.textContent='Could not estimate age/gender. Try a clearer face.'; notesValue.textContent='Analysis failed — try a well-lit, front-facing photo.'; return; } const age=Math.round(result.age||0); const gender=result.gender||'unknown'; const genderProb=result.genderProbability||0; ageEl.textContent=`${age}`; genderEl.textContent=`${gender} ${(genderProb*100).toFixed(1)}%`; const skin=analyzeSkin(previewImg, faceBox||result.detection.box); swatchEl.style.background=skin.hex; skinHexEl.textContent=skin.hex; toneEl.textContent=skin.tone; undertoneEl.textContent=skin.undertone; analysis={ age, gender, genderProb, skin:{hex:skin.hex,tone:skin.tone,undertone:skin.undertone}, skinToneBucket: skin.tone }; notesValue.textContent='Analysis complete (approximate).'; detectStatus.textContent='Ready for suggestions.'; getBtn.disabled=false; }
});
