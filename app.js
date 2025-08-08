// app.js
(async function() {
  const loadingMsg = document.getElementById('loadingMessage');
  const charDiv      = document.getElementById('characteristics');
  const imgPreview   = document.getElementById('imagePreview');
  const facePreview  = document.getElementById('faceCropPreview');
  const weatherSec   = document.getElementById('weatherSection');
  const recommendBtn = document.getElementById('recommendBtn');
  const recDiv       = document.getElementById('recommendations');

  // show loader
  loadingMsg.style.display = 'block';
  charDiv.textContent = 'Loading face recognition models...';

  // load models from /models
  await faceapi.nets.tinyFaceDetector.loadFromUri('/models');
  await faceapi.nets.faceLandmark68Net.loadFromUri('/models');
  await faceapi.nets.ageGenderNet.loadFromUri('/models');
  await faceapi.nets.faceExpressionNet.loadFromUri('/models');

  loadingMsg.style.display = 'none';
  charDiv.textContent = 'Please upload a photo.';

  let lastChars = {};

  document.getElementById('photoInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // reset
    imgPreview.innerHTML = '';
    facePreview.innerHTML = '';
    charDiv.textContent = 'Analyzing photo...';
    weatherSec.style.display = 'none';
    recDiv.innerHTML = 'Select weather and click “Get Recommendations.”';

    // show full image
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    imgPreview.appendChild(img);

    img.onload = async () => {
      const detections = await faceapi
        .detectAllFaces(img, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withAgeAndGender()
        .withFaceExpressions();

      if (!detections.length) {
        charDiv.textContent = 'No face detected. Try another photo.';
        return;
      }

      const face = detections[0];
      const age  = Math.round(face.age || 0);
      const gen  = face.gender || 'unknown';
      const genP = face.genderProbability || 0;
      const expEntries = Object.entries(face.expressions || {});
      const [topExp, topP] = expEntries.length
        ? expEntries.reduce((a,b)=> a[1]>b[1]?a:b)
        : ['none',0];

      // approximate skin tone
      let skinTone = 'n/a';
      try {
        const box = face.detection.box;
        const cnv = document.createElement('canvas');
        cnv.width = box.width; cnv.height = box.height;
        const ctx = cnv.getContext('2d');
        ctx.drawImage(img, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
        const data = ctx.getImageData(0,0,box.width,box.height).data;
        let [r,g,b,count] = [0,0,0,0];
        for (let i=0; i<data.length; i+=4) { r+=data[i]; g+=data[i+1]; b+=data[i+2]; count++; }
        skinTone = `rgb(${ Math.round(r/count) },${ Math.round(g/count) },${ Math.round(b/count) })`;
        facePreview.innerHTML = '';
        facePreview.appendChild(cnv);
      } catch {
        skinTone = 'error';
      }

      // approximate face shape
      let faceShape = 'Unknown';
      try {
        const pts = face.landmarks.positions;
        let [minX,maxX,minY,maxY] = [Infinity,-Infinity,Infinity,-Infinity];
        pts.forEach(p=>{
          if(p.x<minX) minX=p.x;
          if(p.x>maxX) maxX=p.x;
          if(p.y<minY) minY=p.y;
          if(p.y>maxY) maxY=p.y;
        });
        const w = maxX-minX, h = maxY-minY, ratio = w/h;
        faceShape = (ratio>=0.9 && ratio<=1.1) ? 'Square' : (ratio<0.9 ? 'Oval' : 'Round');
      } catch {}

      charDiv.innerHTML = `
        <div>Face color: <span style="background:${skinTone};padding:0 1em;border-radius:3px;"> </span> ${skinTone}</div>
        <div>Age: ${age} years</div>
        <div>Gender: ${gen} (${(genP*100).toFixed(1)}%)</div>
        <div>Expression: ${topExp} (${(topP*100).toFixed(1)}%)</div>
        <div>Face shape: ${faceShape}</div>
      `;

      lastChars = { age, gender: gen, skinTone, faceShape };
      weatherSec.style.display = 'block';
    };
  });

  recommendBtn.addEventListener('click', () => {
    const weather = document.getElementById('weatherSelect').value;
    recDiv.textContent = 'Generating outfit suggestions…';

    // dummy recommendations; swap for real API calls
    const dummy = {
      summer: ['Linen shirt','Chino shorts','Canvas sneakers','Sunglasses','Panama hat'],
      winter: ['Wool coat','Layered sweater','Slim jeans','Leather boots','Knit scarf'],
      rainy:  ['Waterproof jacket','Quick-dry pants','Rain boots','Compact umbrella','Water-resistant bag'],
      spring: ['Denim jacket','Floral tee','Khaki pants','White sneakers','Light scarf'],
      autumn: ['Leather jacket','Light sweater','Corduroy trousers','Chelsea boots','Fedora hat']
    };

    const picks = dummy[weather] || [];
    recDiv.innerHTML = '';
    picks.forEach(item => {
      const d = document.createElement('div');
      d.className = 'recommendation-item';
      d.textContent = item;
      recDiv.appendChild(d);
    });

    // → later: call your own /api/recommend endpoint instead of dummy
  });
})();
