import os
import math
import cv2
import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..database import get_db, SLIDES_DIR
from ..models import Slide, NuclearRatioRequest
from ..services.color_deconv import deconvolve_tile, compute_nc_ratio

router = APIRouter()


@router.get("/{slide_id}/color-deconv/{channel}/{level}/{tile_name}")
def get_deconv_tile(slide_id: int, channel: str, level: int, tile_name: str, db: Session = Depends(get_db)):
    if channel not in ("hematoxylin", "eosin", "residual"):
        raise HTTPException(400, "Channel must be hematoxylin, eosin, or residual")

    tile_path = os.path.join(SLIDES_DIR, str(slide_id), "slide_files", str(level), tile_name)
    if not os.path.isfile(tile_path):
        raise HTTPException(404, "Tile not found")

    tile_bgr = cv2.imread(tile_path, cv2.IMREAD_COLOR)
    if tile_bgr is None:
        raise HTTPException(500, "Cannot read tile")

    result = deconvolve_tile(tile_bgr, channel)
    _, encoded = cv2.imencode(".jpeg", result, [cv2.IMWRITE_JPEG_QUALITY, 85])

    return Response(content=encoded.tobytes(), media_type="image/jpeg",
                    headers={"Cache-Control": "public, max-age=3600"})


def _reconstruct_roi_from_tiles(slide_id: int, slide: "Slide", x: int, y: int, w: int, h: int) -> np.ndarray:
    """
    Reconstruct a region from pre-generated tiles instead of loading the full image.
    Picks the appropriate pyramid level to keep the working region <= 4096px per side.
    """
    max_level = math.ceil(math.log2(max(slide.width, slide.height)))
    tile_size = slide.tile_size or 256

    target_max_dim = min(max(w, h), 4096)
    scale_needed = target_max_dim / max(w, h) if max(w, h) > 4096 else 1.0
    level_offset = 0
    if scale_needed < 1.0:
        level_offset = math.ceil(-math.log2(scale_needed))
    level = max(0, max_level - level_offset)

    downsample = 2 ** (max_level - level)
    lx = int(x / downsample)
    ly = int(y / downsample)
    lw = int(math.ceil(w / downsample))
    lh = int(math.ceil(h / downsample))

    col_start = lx // tile_size
    col_end = (lx + lw - 1) // tile_size
    row_start = ly // tile_size
    row_end = (ly + lh - 1) // tile_size

    tiles_dir = os.path.join(SLIDES_DIR, str(slide_id), "slide_files", str(level))
    if not os.path.isdir(tiles_dir):
        raise HTTPException(500, f"Tile level {level} not found")

    level_w = math.ceil(slide.width / downsample)
    level_h = math.ceil(slide.height / downsample)
    overlap = slide.overlap or 1

    canvas = np.zeros((lh, lw, 3), dtype=np.uint8)

    for col in range(col_start, col_end + 1):
        for row in range(row_start, row_end + 1):
            tile_path = os.path.join(tiles_dir, f"{col}_{row}.jpeg")
            if not os.path.isfile(tile_path):
                continue

            tile_img = cv2.imread(tile_path, cv2.IMREAD_COLOR)
            if tile_img is None:
                continue

            tile_x_start = col * tile_size - (overlap if col > 0 else 0)
            tile_y_start = row * tile_size - (overlap if row > 0 else 0)
            tile_x_start = max(0, tile_x_start)
            tile_y_start = max(0, tile_y_start)

            src_x_off = max(0, lx - tile_x_start)
            src_y_off = max(0, ly - tile_y_start)

            dst_x = max(0, tile_x_start - lx)
            dst_y = max(0, tile_y_start - ly)

            th, tw = tile_img.shape[:2]
            copy_w = min(tw - src_x_off, lw - dst_x)
            copy_h = min(th - src_y_off, lh - dst_y)

            if copy_w <= 0 or copy_h <= 0:
                continue

            canvas[dst_y:dst_y+copy_h, dst_x:dst_x+copy_w] = \
                tile_img[src_y_off:src_y_off+copy_h, src_x_off:src_x_off+copy_w]

    return canvas


@router.post("/{slide_id}/nuclear-ratio")
def nuclear_ratio(slide_id: int, data: NuclearRatioRequest, db: Session = Depends(get_db)):
    slide = db.query(Slide).filter(Slide.id == slide_id).first()
    if not slide or slide.status != "ready":
        raise HTTPException(404, "Slide not available")

    roi = data.roi
    if not roi:
        raise HTTPException(400, "ROI required: {x, y, width, height}")

    x = max(0, int(roi.get("x", 0)))
    y = max(0, int(roi.get("y", 0)))
    w = min(int(roi.get("width", 256)), slide.width - x)
    h = min(int(roi.get("height", 256)), slide.height - y)

    if w <= 0 or h <= 0:
        raise HTTPException(400, "Invalid ROI dimensions")

    roi_bgr = _reconstruct_roi_from_tiles(slide_id, slide, x, y, w, h)
    roi_rgb = cv2.cvtColor(roi_bgr, cv2.COLOR_BGR2RGB)

    result = compute_nc_ratio(roi_rgb)

    if slide.um_per_pixel:
        max_level = math.ceil(math.log2(max(slide.width, slide.height)))
        level_offset = 0
        if max(w, h) > 4096:
            level_offset = math.ceil(math.log2(max(w, h) / 4096))
        downsample = 2 ** level_offset
        effective_um = slide.um_per_pixel * downsample
        px_area = effective_um ** 2
        result["nuclear_area_um2"] = round(result["nuclear_area_px"] * px_area, 2)
        result["cytoplasm_area_um2"] = round(result["cytoplasm_area_px"] * px_area, 2)

    return result
