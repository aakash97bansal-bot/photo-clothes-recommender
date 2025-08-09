// Milestone B: face detection (TinyFaceDetector) + overlay box (with path fallbacks)
document.addEventListener('DOMContentLoaded', async () => {
  const photoInput   = document.getElementById('photoInput');
  const previewImg   = document.getElementById('previewImg');
  const placeholder  = document.getElementById('placeholder');
  const overlay      = document.getElementById('overlay');
  const detectStatus = document.getElementById('detectStatus');
  const notesValue   = document.getElementById('notesValue');
  const frameEl      = document.getElementById('imageFrame');

  let lastDetection = null; // keep for redraw on resize

  // ---------- helpers ----------
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

  async function loadFaceApiModelsWithFallback(statusEl) {
    const bases = [
      './models',   // repo-root models/ (works on GitHub Pages & most static hosts)
      '/models',    // domain-root models/ (works on Netlify/Vercel at root)
      'models'      // relative fallback
    ];
    let lastErr = null;

    for (const base of bases) {
      try {
        statusEl.textContent = `Loading face models from ${base} …`;
        // Milestone B requires ONLY TinyFaceDetector
        await faceapi.nets.tinyFaceDetector.loadFromUri(base);
        statusEl.textContent = `Models loaded from ${base}. Select a photo.`;
        console.log('✅ face-api tiny model loaded from', base);
        return base;
      } catch (err) {
        console.warn('❌ Failed to load tiny model from', base, err);
        lastErr = err;
      }
    }
    statusEl.textContent = 'Failed to load models. Ensure a /models folder (json + bin) exists at repo root.';
    throw lastErr || new Error('Model load failed on all tested paths');
  }

  // ---------- load model(s) ----------
  try {
    await loadFaceApiModelsWithFallback(detectStatus);
  } catch (e) {
    console.error(e);
    // stop here; UI will show the failure note already
    return;
  }

  // ---------- handle image selection + detection ----------
  photoInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // preview image
    const url = URL.createObjectURL(file);
    previewImg.src = url;
    previewImg.style.display = 'block';
    placeholder.style.display = 'none';

    previewImg.onload = async () => {
      URL.revokeObjectURL(url);

      // size overlay to the visible frame
      resizeOverlayToImage();

      const ctx = overlay.getContext('2d');
      ctx.clearRect(0, 0, overlay.width, overlay.height);

      detectStatus.textContent = 'Detecting face…';

      // smaller inputSize is faster; tweak if needed (160–416)
      const options = new faceapi.TinyFaceDetectorOptions({
        inputSize: 256,
        scoreThreshold: 0.5
      });

      let detections = [];
      try {
        // Passing the <img> element returns boxes in displayed pixel coords
        detections = await faceapi.detectAllFaces(previewImg, options);
      } catch (err) {
        console.error('Detection error:', err);
        detectStatus.textContent = 'Detection error. Check console.';
        notesValue.textContent = 'An error occurred during detection. Try another image.';
        return;
      }

      if (!detections.length) {
        detectStatus.textContent = 'No face found. Try a clearer, frontal photo.';
        notesValue.textContent = 'No face detected — ensure good lighting and a front-facing photo.';
        lastDetection = null;
        return;
      }

      // pick largest face as primary
      const primary = detections.reduce((max, d) => {
        const a = d.box.width * d.box.height;
        const b = max.box.width * max.box.height;
        return a > b ? d : max;
      });

      drawBox(primary);
      lastDetection = primary;

      detectStatus.textContent = `Face detected ✓ (score ${(primary.score * 100).toFixed(0)}%)`;
      notesValue.textContent = 'Primary face detected. Age/gender and skin analysis will be added next.';
    };
  });

  // redraw on resize (keeps box aligned with the image frame)
  window.addEventListener('resize', () => {
    if (!previewImg.src) return;
    resizeOverlayToImage();
    drawBox(lastDetection);
  });
});
