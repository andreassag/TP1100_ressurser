# Run: uv run uvicorn app:app --reload --port 8001

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
ASSETS_DIR = BASE_DIR / "assets"

app = FastAPI(title="Respiratory System Visualizer")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")


from fastapi.responses import FileResponse, RedirectResponse

@app.get("/")
async def index() -> RedirectResponse:
    return RedirectResponse(url="/mechanics")

@app.get("/mechanics")
async def mechanics() -> FileResponse:
    return FileResponse(STATIC_DIR / "mechanics.html")

@app.get("/exchange")
async def exchange() -> FileResponse:
    return FileResponse(STATIC_DIR / "exchange.html")
