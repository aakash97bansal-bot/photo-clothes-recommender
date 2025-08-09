// Milestones B+C+D+E (No-API mode): detection + analysis + on-device outfit suggestions
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

  // ---- API config (leave empty for No-API mode) ----
  const API_BASE = ""; // e.g. "https://ai-stylist-api.vercel.app" later
  const API_RECOMMEND = () => `${API_BASE}/api/recommend`;

  // ---- state ----
  let tinyReady=false, lmkReady=false, agReady=false;
  let lastDetection=null;
  let analysis=null; // { age, gender, genderProb, skin:{hex,tone,undertone} }

  // ---- helpers ----
  function resizeOverlayToImage(){ overlay.width=frameEl.clientWidth; overlay.height=frameEl.clientHeight; }
  function drawBox(det){ const ctx=overlay.getContext('2d'); ctx.clearRect(0,0,overlay.width,overlay.height); if(!det) return;
    const {x,y,width,height}=det.box; ctx.lineWidth=3; ctx.strokeStyle='#4da3ff'; ctx.strokeRect(x,y,width,height); }
  function options(){ return new faceapi.TinyFaceDetectorOptions({ inputSize:256, scoreThreshold:0.5 }); }

  // ---- model loaders (local → remote fallback) ----
  async function loadNetWithFallback(netLoader, localBase, remoteBase, manifestFile, label){
    try{
      const m = new URL(manifestFile, localBase).href;
      console.log(`🔎 ${label} LOCAL manifest:`, m);
      const r = await fetch(m,{cache:'no-store'}); if(!r.ok) throw new Error(`HTTP ${r.status}`);
      await netLoader(localBase); console.log(`✅ ${label} loaded LOCAL`); return;
    }catch(e){ console.warn(`${label} local failed → remote`, e); }
    const rm = new URL(manifestFile, remoteBase).href;
    console.log(`🔎 ${label} REMOTE manifest:`, rm);
    const rr = await fetch(rm,{cache:'no-store'}); if(!rr.ok) throw new Error(`HTTP ${rr.status}`);
    await netLoader(remoteBase); console.log(`✅ ${label} loaded REMOTE`);
  }

  async function loadAllModels(){
    if (typeof faceapi==='undefined'){ detectStatus.textContent='face-api.js not found (check script tag)'; return; }
    const LOCAL = new URL('models/', location.href).href;
    const REM_TFD='https://raw.githubusercontent.com/justadudewhohacks/face-api.js-models/master/tiny_face_detector/';
    const REM_LMK='https://raw.githubusercontent.com/justadudewhohacks/face-api.js-models/master/face_landmark_68/';
    const REM_AG ='https://raw.githubusercontent.com/justadudewhohacks/face-api.js-models/master/age_gender_model/';
    detectStatus.textContent='Loading face models…';
    await loadNetWithFallback(b=>faceapi.nets.tinyFaceDetector.loadFromUri(b), LOCAL, REM_TFD, 'tiny_face_detector_model-weights_manifest.json', 'TinyFaceDetector'); tinyReady=true;
    await loadNetWithFallback(b=>faceapi.nets.faceLandmark68Net.loadFromUri(b), LOCAL, REM_LMK, 'face_landmark_68_model-weights_manifest.json', 'Landmarks68'); lmkReady=true;
    await loadNetWithFallback(b=>faceapi.nets.ageGenderNet.loadFromUri(b), LOCAL, REM_AG, 'age_gender_model-weights_manifest.json', 'AgeGender'); agReady=true;
    detectStatus.textContent='Models loaded. Select a photo.';
  }

  // ---- color utilities ----
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
    let r=0,g=0,b=0,c=0;
    for(let i=0;i<data.length;i+=4){
      const R=data[i], G=data[i+1], B=data[i+2], A=data[i+3];
      if (A<200) continue;
      const max=Math.max(R,G,B), min=Math.min(R,G,B), l=(max+min)/510, s=max===min?0:(l>0.5?(max-min)/(510-max-min):(max-min)/(max+min));
      if (s>0.6 || l<0.15 || l>0.95) continue;
      r+=R; g+=G; b+=B; c++;
    }
    if(!c) return null;
    return { r:Math.round(r/c), g:Math.round(g/c), b:Math.round(b/c) };
  }
  function analyzeSkin(previewImg, faceBox){
    const w=frameEl.clientWidth, h=frameEl.clientHeight;
    const cnv=document.createElement('canvas'); cnv.width=w; cnv.height=h;
    const ctx=cnv.getContext('2d'); ctx.drawImage(previewImg,0,0,w,h);
    const [L,R]=cheekRectsFromBox(faceBox);
    const c1=sampleAverageRGB(ctx,L), c2=sampleAverageRGB(ctx,R);
    const rgb = c1&&c2 ? { r:Math.round((c1.r+c2.r)/2), g:Math.round((c1.g+c2.g)/2), b:Math.round((c1.b+c2.b)/2) } : (c1||c2||{r:180,g:140,b:120});
    const hex = rgbToHex(rgb.r,rgb.g,rgb.b);
    const Y = relativeLuminance(rgb.r,rgb.g,rgb.b);
    const tone = Y>=0.70?'light':(Y>=0.45?'medium':'deep');
    const diffRB=(rgb.r-rgb.b)/255, diffBR=(rgb.b-rgb.r)/255;
    const undertone = diffRB>0.12 && rgb.g>=rgb.b ? 'warm' : (diffBR>0.10 ? 'cool' : 'neutral');
    return { rgb, hex, tone, undertone };
  }

  // ---- detection & analysis pipeline ----
  async function detectPrimaryFace(){
    resizeOverlayToImage();
    const ctx=overlay.getContext('2d'); ctx.clearRect(0,0,overlay.width,overlay.height);
    detectStatus.textContent='Detecting face…';
    const dets=await faceapi.detectAllFaces(previewImg, options());
    if(!dets.length){ detectStatus.textContent='No face found. Try a clearer, frontal photo.'; notesValue.textContent='No face detected — ensure good lighting and a front-facing photo.'; lastDetection=null; drawBox(null); return null; }
    const primary=dets.reduce((m,d)=> (d.box.width*d.box.height)>(m.box.width*m.box.height)?d:m);
    drawBox(primary); lastDetection=primary; detectStatus.textContent=`Face detected ✓ (score ${(primary.score*100).toFixed(0)}%)`;
    return primary;
  }

  async function detectAgeGenderAndSkin(faceBox){
    if(!agReady||!lmkReady){ detectStatus.textContent='Models still loading…'; return; }
    detectStatus.textContent='Estimating age, gender & skin…';
    const result=await faceapi.detectSingleFace(previewImg, options()).withFaceLandmarks().withAgeAndGender();
    if(!result){ detectStatus.textContent='Could not estimate age/gender. Try a clearer face.'; notesValue.textContent='Analysis failed — try a well-lit, front-facing photo.'; return; }

    const age=Math.round(result.age||0);
    const gender=result.gender||'unknown';
    const genderProb=result.genderProbability||0;
    ageEl.textContent=`${age}`;
    genderEl.textContent=`${gender} ${(genderProb*100).toFixed(1)}%`;

    const skin=analyzeSkin(previewImg, faceBox||result.detection.box);
    swatchEl.style.background=skin.hex;
    skinHexEl.textContent=skin.hex;
    toneEl.textContent=skin.tone;
    undertoneEl.textContent=skin.undertone;

    analysis={ age, gender, genderProb, skin:{hex:skin.hex,tone:skin.tone,undertone:skin.undertone}, skinToneBucket: skin.tone };
    notesValue.textContent='Analysis complete (approximate).';
    detectStatus.textContent='Ready for suggestions.';
    getBtn.disabled=false;
  }

  async function runPipeline(){
    if(!tinyReady){ detectStatus.textContent='Models still loading…'; return; }
    const primary=await detectPrimaryFace(); if(!primary) return;
    await detectAgeGenderAndSkin(primary.box);
  }

  // ---- Local (No-API) recommender ----
  function paletteByUndertoneSeason(undertone, season){
    // Predefined safe palettes; tweak per season
    const BASE = {
      warm:   { primary:'#F5E9DA', accent:'#C07F3A', neutral:'#3F3A34' },
      cool:   { primary:'#E6EFF7', accent:'#3A7BD5', neutral:'#373F51' },
      neutral:{ primary:'#EEEDEA', accent:'#7E7E7E', neutral:'#323232' }
    };
    const P = BASE[undertone] || BASE.neutral;
    const seasonAdjust = {
      summer: v=>v, // keep light
      spring: v=>v,
      rainy:  v=>({ ...v, accent:'#3AA6FF', neutral:'#2B3A4A' }),
      autumn: v=>({ ...v, primary:'#E7D9C8', accent:'#B1682B', neutral:'#3A332C' }),
      winter: v=>({ ...v, primary:'#D9DEE7', accent:'#7A5037', neutral:'#1F242B' }),
    };
    return (seasonAdjust[season]||((x)=>x))(P);
  }

  function localSuggest(a, season){
    const g = (a.gender||'unknown').toLowerCase();
    const tone = a.skinToneBucket || 'medium';
    const u = a.skin?.undertone || 'neutral';
    const pal = paletteByUndertoneSeason(u, season);

    // Simple wardrobes by season + tone + gender-ish
    const isMale = g.startsWith('male');
    const isFemale = g.startsWith('female');

    const S = {
      summer: () => ({
        headwear: isMale ? 'Straw hat (optional)' : 'Wide-brim hat (optional)',
        top: isMale ? 'Off-white linen shirt' : 'Sleeveless linen blouse',
        midlayer: 'None',
        bottoms: isMale ? 'Sand chino shorts' : 'A-line cotton skirt or linen shorts',
        footwear: isMale ? 'White canvas sneakers' : 'Tan sandals',
        accessories: isMale ? 'Brown belt; tortoise sunglasses' : 'Rattan bag; tortoise sunglasses',
        rationale: `Breathable fabrics for heat. ${u} undertone pairs with ${pal.accent} accents.`
      }),
      winter: () => ({
        headwear: 'Rib-knit beanie',
        top: isMale ? 'Merino turtleneck' : 'Merino turtleneck',
        midlayer: isMale ? 'Wool overcoat' : 'Wool wrap coat',
        bottoms: isMale ? 'Dark denim' : 'Thermal leggings + wool skirt or dark denim',
        footwear: 'Leather boots',
        accessories: 'Knit scarf & gloves',
        rationale: `Warm layers; darker neutrals flatter ${tone} tone.`
      }),
      rainy: () => ({
        headwear: 'Waterproof cap',
        top: 'Lightweight rain shell over cotton tee',
        midlayer: 'Packable layer',
        bottoms: 'Quick-dry chinos or tapered joggers',
        footwear: 'Waterproof sneakers',
        accessories: 'Compact umbrella',
        rationale: 'Water-resistant pieces and quick-dry fabrics for showers.'
      }),
      spring: () => ({
        headwear: 'None',
        top: isMale ? 'Chambray shirt' : 'Soft pastel blouse',
        midlayer: isMale ? 'Unlined blazer' : 'Light cardigan',
        bottoms: 'Khaki chinos or straight jeans',
        footwear: 'White sneakers',
        accessories: 'Leather belt; minimal jewelry',
        rationale: `Lighter layers and fresh tones complement ${u} undertone.`
      }),
      autumn: () => ({
        headwear: 'Wool cap (optional)',
        top: 'Crewneck sweater',
        midlayer: isMale ? 'Leather jacket' : 'Suede jacket',
        bottoms: 'Olive chinos or dark denim',
        footwear: 'Chelsea boots',
        accessories: 'Brown belt; textured scarf',
        rationale: `Earth tones align with ${u} undertone and ${tone} skin depth.`
      })
    };

    const base = (S[season]||S.summer)();
    return {
      ...base,
      palette: { primary: pal.primary, accent: pal.accent, neutral: pal.neutral }
    };
  }

  function renderSnippet(s){
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

  // ---- fetchSuggestions: use API if configured; else local ----
  async function fetchSuggestions(payload){
    if (!API_BASE){
      const s = localSuggest(analysis, payload.season);
      return { ok:true, data:s };
    }
    try{
      const res = await fetch(API_RECOMMEND(), {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
      });
      if(!res.ok){ console.warn('API non-200, fallback to local'); return { ok:false, data: localSuggest(analysis, payload.season) }; }
      const data = await res.json(); return { ok:true, data };
    }catch(e){
      console.error('API error, fallback to local', e);
      return { ok:false, data: localSuggest(analysis, payload.season) };
    }
  }

  // ---- events ----
  photoInput.addEventListener('change', (e)=>{
    const file=e.target.files?.[0]; if(!file) return;
    const url=URL.createObjectURL(file);
    previewImg.src=url; previewImg.style.display='block'; placeholder.style.display='none';
    previewImg.onload=()=>{ URL.revokeObjectURL(url); runPipeline(); };
    getBtn.disabled=true; // wait for analysis
  });

  getBtn.addEventListener('click', async ()=>{
    if(!analysis) return;
    getBtn.disabled=true;
    const season=seasonSelect.value;
    detectStatus.textContent='Generating outfit suggestions…';

    const payload = {
      age: analysis.age, gender: analysis.gender,
      genderConfidence: Number((analysis.genderProb*100).toFixed(1)),
      skinHex: analysis.skin.hex,
      skinToneBucket: analysis.skinToneBucket,
      undertone: analysis.skin.undertone,
      season
    };

    const { data } = await fetchSuggestions(payload);
    renderSnippet(data);
    detectStatus.textContent='Suggestions ready.';
    getBtn.disabled=false;
  });

  // ---- start loading models (don’t block preview) ----
  try{
    await loadAllModels();
    if (previewImg.complete && previewImg.naturalWidth>0) await runPipeline();
  }catch(e){ console.error('Model load failed:', e); detectStatus.textContent='Failed to load models. See console.'; }

  window.addEventListener('resize', ()=>{ if(!previewImg.src) return; resizeOverlayToImage(); drawBox(lastDetection); });

  async function runPipeline(){ if(!tinyReady){ detectStatus.textContent='Models still loading…'; return; } const primary=await detectPrimaryFace(); if(!primary) return; await detectAgeGenderAndSkin(primary.box); }
});
