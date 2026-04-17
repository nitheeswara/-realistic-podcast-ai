from pathlib import Path
from tempfile import mkdtemp
from typing import Annotated

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

app = FastAPI(title="Realistic Podcast AI Python Services")


async def save_upload(upload: UploadFile, target: Path) -> Path:
    content = await upload.read()
    if not content:
        raise HTTPException(status_code=400, detail=f"{upload.filename or 'file'} is empty")

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
    return target


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/wav2lip")
async def wav2lip(
    video: Annotated[UploadFile, File()],
    audio: Annotated[UploadFile, File()],
) -> FileResponse:
    """Placeholder endpoint for a Wav2Lip worker.

    Replace the passthrough body with model inference when the Python model assets
    are installed. The Next.js worker treats failed enhancement calls as skipped,
    so this service can be introduced incrementally.
    """
    temp_path = Path(mkdtemp(prefix="rpa-wav2lip-"))
    video_path = await save_upload(video, temp_path / (video.filename or "input.mp4"))
    await save_upload(audio, temp_path / (audio.filename or "input.wav"))
    output_path = temp_path / "enhanced.mp4"
    output_path.write_bytes(video_path.read_bytes())

    return FileResponse(output_path, media_type="video/mp4", filename="enhanced.mp4")


@app.post("/sadtalker")
async def sadtalker(
    image: Annotated[UploadFile, File()],
    audio: Annotated[UploadFile, File()],
) -> None:
    await image.read()
    await audio.read()
    raise HTTPException(
        status_code=501,
        detail="SadTalker model assets are not installed yet.",
    )