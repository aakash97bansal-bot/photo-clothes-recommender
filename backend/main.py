import uvicorn
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict
import shutil
import os
from pathlib import Path

app = FastAPI()

# Enable CORS for local frontend testing
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust for prod!
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

@app.post("/analyze")
async def analyze_image(file: UploadFile = File(...)) -> Dict:
    # Save uploaded file
    file_path = UPLOAD_DIR / file.filename
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # Dummy response for the POC
    # In a real setup, call DeepFace.analyze(...) or other pipelines here
    # Example:
    # result = DeepFace.analyze(str(file_path), actions=['age', 'gender', 'race', 'emotion'])
    # For body structure, use mediapipe or pose estimation models

    result = {
        "skin_color": "medium",
        "skin_tone": "warm",
        "face_structure": "oval",
        "body_structure": "ectomorph",
        "age": 27,
        "gender": "male",
        "confidence": 0.85,
        "message": "This is a dummy response; connect ML models here."
    }

    # Optionally, clean up file after processing
    os.remove(file_path)

    return result

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)