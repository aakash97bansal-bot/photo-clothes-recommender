document.getElementById('photoInput').addEventListener('change', function(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('imagePreview').innerHTML = `<img src="${e.target.result}" alt="Uploaded Photo" />`;
            // Simulate characteristic detection (replace with real AI integration later)
            setTimeout(() => {
                const demoCharacteristics = [
                    "Face color: Medium Brown",
                    "Body structure: Average",
                    "Gender: Not detected (demo)",
                    "Age group: Not detected (demo)"
                ];
                document.getElementById('characteristics').innerHTML = demoCharacteristics.map(c => `<div>${c}</div>`).join('');
            }, 1000);
        };
        reader.readAsDataURL(file);
    } else {
        document.getElementById('imagePreview').innerHTML = '';
        document.getElementById('characteristics').textContent = '';
    }
});