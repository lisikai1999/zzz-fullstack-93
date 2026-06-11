import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .database import init_db
from .routers import slides, tiles, annotations, analysis


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Digital Pathology Viewer", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(slides.router, prefix="/api/v1/slides", tags=["slides"])
app.include_router(tiles.router, prefix="/api/v1/tiles", tags=["tiles"])
app.include_router(annotations.router, prefix="/api/v1/annotations", tags=["annotations"])
app.include_router(analysis.router, prefix="/api/v1/analysis", tags=["analysis"])

frontend_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
