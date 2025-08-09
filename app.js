// Milestone B: face detection (TinyFaceDetector) + overlay box
document.addEventListener('DOMContentLoaded', async () => {
  const photoInput  = document.getElementById('photoInput');
  const previewImg  = document.getElementById('previewImg');
  const placeholder = document.getElementById('placeholder');
  const overlay     = document.getElementById('overlay');
  const detectStatus= document.getElementById('detectStatus');
  const notesValue  = document.getElementById('notesValue');

  // Helper: adjust overlay to match displayed image size
  function resizeOverlayToImage() {
    const rect = previewImg.getBoundingClientRect();
    const frame = document.getElementById('imageFrame');
    overlay.width  = frame.clientWidth;
    overlay.height = frame.clientHeight;
  }

  // 1) Load models
  try {
    detectStatus.textContent = 'Loading face models…';
    // NOTE: Place model files under /public/models/ (so they’re served as /public/models/...)
    await faceapi.nets.tinyFaceDetector.loadFromUri('/public/models');
    // (Landmarks/age/gender will be loaded in later milestones)
    await faceapi.nets.tinyFaceDetector.loadFromUri('./models');
    await faceapi.nets.faceLandmark68Net.loadFromUri('./models');
    await faceapi.nets.ageGenderNet.loadFromUri('./models');
    detectStatus.textContent = 'Models loaded. Select a photo.';
  } catch (e) {
    console.error(e);
    detectStatus.textContent = 'Failed to load models. Check /public/models path.';
    return;
  }

  // 2) Handle image selection + detection
  photoInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Show preview
    const url = URL.createObjectURL(file);
    previewImg.src = url;
    previewImg.style.display = 'block';
    placeholder.style.display = 'none';

    previewImg.onload = async () => {
      URL.revokeObjectURL(url);
      // Ensure overlay matches visible size
      resizeOverlayToImage();

      const ctx = overlay.getContext('2d');
      ctx.clearRect(0, 0, overlay.width, overlay.height);

      detectStatus.textContent = 'Detecting face…';

      // Detect (use small input size for speed)
      const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 256, scoreThreshold: 0.5 });

      // We detect all, then pick the largest box (best primary face)
      const detections = await faceapi.detectAllFaces(previewImg, options);
      if (!detections.length) {
        detectStatus.textContent = 'No face found. Try a clearer, frontal photo.';
        notesValue.textContent = 'No face detected — ensure good lighting and a front-facing photo.';
        return;
      }

      // Pick largest detection
      const primary = detections.reduce((max, d) => {
        const area = d.box.width * d.box.height;
        const maxArea = max.box.width * max.box.height;
        return area > maxArea ? d : max;
      });

      // Draw box scaled to display size
      // Map detection box (based on rendered size, since we passed the <img> element)
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#4da3ff';
      ctx.strokeRect(primary.box.x, primary.box.y, primary.box.width, primary.box.height);

      detectStatus.textContent = `Face detected ✓ (score ${(primary.score*100).toFixed(0)}%)`;
      notesValue.textContent = 'Primary face detected. Age/gender and skin analysis will be added next.';
    };
  });

  // Keep overlay in sync on window resize
  window.addEventListener('resize', () => {
    if (previewImg.src) {
      resizeOverlayToImage();
    }
  });
});
