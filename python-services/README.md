# Python Services

Run the optional local service for Phase 3 lipsync enhancement:

```powershell
cd python-services
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Set `PYTHON_SERVICE_URL=http://127.0.0.1:8000` in `.env.local` for the Next.js video worker. The Wav2Lip endpoint is a passthrough stub until model assets are installed; SadTalker returns an explicit 501 until its model bundle is added.