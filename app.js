// Wait for face-api.js to load
window.addEventListener('DOMContentLoaded', async function() {
    const loadingMsg = document.getElementById('loadingMessage');
    loadingMsg.style.display = 'block';
    document.getElementById('characteristics').textContent = "Loading face recognition models...";
    // Load models from CDN
    await faceapi.nets.tinyFaceDetector.loadFromUri('https://cdn.jsdelivr.net/npm/face-api.js/weights');
    await faceapi.nets.faceLandmark68Net.loadFromUri('https://cdn.jsdelivr.net/npm/face-api.js/weights');
    await faceapi.nets.faceRecognitionNet.loadFromUri('https://cdn.jsdelivr.net/npm/face-api.js/weights');
    await faceapi.nets.ageGenderNet.loadFromUri('https://cdn.jsdelivr.net/npm/face-api.js/weights');
    await faceapi.nets.faceExpressionNet.loadFromUri('https://cdn.jsdelivr.net/npm/face-api.js/weights');
    loadingMsg.style.display = 'none';
    document.getElementById('characteristics').textContent = "Please upload a photo.";
});

document.getElementById('photoInput').addEventListener('change', async function(event) {
    const file = event.target.files[0];
    const imagePreview = document.getElementById('imagePreview');
    const characteristics = document.getElementById('characteristics');
    const faceCropPreview = document.getElementById('faceCropPreview');
    if (file) {
        // Clean up previous
        imagePreview.innerHTML = '';
        characteristics.textContent = 'Analyzing photo...';
        faceCropPreview.innerHTML = '';
        // Load image
        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        img.onload = async () => {
            imagePreview.appendChild(img);

            // Detect face(s)
            const detections = await faceapi
                .detectAllFaces(img, new faceapi.TinyFaceDetectorOptions())
                .withFaceLandmarks()
                .withFaceDescriptors()
                .withAgeAndGender()
                .withFaceExpressions();

            if (!detections.length) {
                characteristics.textContent = "No face detected. Try another photo.";
                return;
            }

            // Use only the first detected face for demo
            const face = detections[0];
            const { age, gender, genderProbability, expressions, detection } = face;
            // Age is float, round to nearest
            const ageStr = age ? `${Math.round(age)} years` : "Not detected";
            // Gender with confidence
            const genderStr = gender ? `${gender} (${(genderProbability*100).toFixed(1)}%)` : "Not detected";
            // Expression with max probability
            const expressionEntries = Object.entries(expressions || {});
            const [topExpression, topProb] = expressionEntries.length
              ? expressionEntries.reduce((a, b) => (a[1]>b[1]?a:b))
              : ["Not detected", 0];

            // Estimate skin tone from the face crop (simple average color)
            let skinTone = "Not detected";
            try {
                // Crop face region and analyze average color
                const box = detection.box;
                const faceCanvas = document.createElement('canvas');
                faceCanvas.width = box.width;
                faceCanvas.height = box.height;
                const ctx = faceCanvas.getContext('2d');
                ctx.drawImage(img, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
                const imageData = ctx.getImageData(0, 0, box.width, box.height);
                let r = 0, g = 0, b = 0, count = 0;
                for (let i = 0; i < imageData.data.length; i += 4) {
                    r += imageData.data[i];
                    g += imageData.data[i+1];
                    b += imageData.data[i+2];
                    count++;
                }
                r = Math.round(r/count);
                g = Math.round(g/count);
                b = Math.round(b/count);
                skinTone = `rgb(${r},${g},${b})`;
                // Show face crop preview
                faceCropPreview.innerHTML = '<canvas width="'+box.width+'" height="'+box.height+'"></canvas>';
                faceCropPreview.querySelector('canvas').getContext('2d').putImageData(imageData, 0, 0);
            } catch (e) {
                skinTone = "Error estimating";
            }

            characteristics.innerHTML = `
                <div>Face color (skin tone): <span style="background:${skinTone};padding:0 1em;border-radius:3px;">&nbsp;</span> ${skinTone}</div>
                <div>Age: ${ageStr}</div>
                <div>Gender: ${genderStr}</div>
                <div>Expression: ${topExpression} (${(topProb*100).toFixed(1)}%)</div>
            `;
        };
    } else {
        imagePreview.innerHTML = '';
        characteristics.textContent = '';
        faceCropPreview.innerHTML = '';
    }
});
