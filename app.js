// Milestone A: static UI + working image preview (no ML yet)
document.addEventListener('DOMContentLoaded', () => {
  const photoInput = document.getElementById('photoInput');
  const previewImg = document.getElementById('previewImg');
  const placeholder = document.getElementById('placeholder');
  const getBtn = document.getElementById('getSuggestionsBtn');

  // Just a preview for now
  photoInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    previewImg.src = url;
    previewImg.onload = () => URL.revokeObjectURL(url);
    previewImg.style.display = 'block';
    placeholder.style.display = 'none';

    // In later milestones, enabling this button will require successful analysis
    // For now, keep disabled to match our step-by-step plan
    getBtn.disabled = true;
  });
});
