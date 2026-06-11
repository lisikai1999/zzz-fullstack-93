import os
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from ..database import SLIDES_DIR

router = APIRouter()


@router.get("/{slide_id}/{level}/{tile_name}")
def get_tile(slide_id: int, level: int, tile_name: str):
    if not tile_name.endswith(".jpeg"):
        raise HTTPException(400, "Tile must be .jpeg")

    tile_path = os.path.join(SLIDES_DIR, str(slide_id), "slide_files", str(level), tile_name)

    if not os.path.isfile(tile_path):
        raise HTTPException(404, "Tile not found")

    return FileResponse(
        tile_path,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=86400"},
    )
