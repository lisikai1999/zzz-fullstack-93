import os
import math
import cv2
import numpy as np
from PIL import Image


def generate_dzi(image_path: str, output_dir: str, tile_size: int = 256, overlap: int = 1) -> dict:
    """
    Generate a DZI tile pyramid from an image file.
    Returns dict with width, height, max_level, dzi_path.
    """
    img = cv2.imread(image_path, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"Cannot read image: {image_path}")

    height, width = img.shape[:2]
    max_level = math.ceil(math.log2(max(width, height)))

    tiles_dir = os.path.join(output_dir, "slide_files")
    os.makedirs(tiles_dir, exist_ok=True)

    levels = {}
    levels[max_level] = img

    for level in range(max_level - 1, -1, -1):
        prev = levels[level + 1]
        h, w = prev.shape[:2]
        new_w = max(1, math.ceil(w / 2))
        new_h = max(1, math.ceil(h / 2))
        levels[level] = cv2.resize(prev, (new_w, new_h), interpolation=cv2.INTER_AREA)

    for level in range(max_level + 1):
        level_img = levels[level]
        lh, lw = level_img.shape[:2]
        level_dir = os.path.join(tiles_dir, str(level))
        os.makedirs(level_dir, exist_ok=True)

        cols = math.ceil(lw / tile_size)
        rows = math.ceil(lh / tile_size)

        for col in range(cols):
            for row in range(rows):
                x1 = col * tile_size - (overlap if col > 0 else 0)
                y1 = row * tile_size - (overlap if row > 0 else 0)
                x2 = min(lw, (col + 1) * tile_size + overlap)
                y2 = min(lh, (row + 1) * tile_size + overlap)
                x1 = max(0, x1)
                y1 = max(0, y1)

                tile = level_img[y1:y2, x1:x2]
                tile_path = os.path.join(level_dir, f"{col}_{row}.jpeg")
                cv2.imwrite(tile_path, tile, [cv2.IMWRITE_JPEG_QUALITY, 85])

    dzi_path = os.path.join(output_dir, "slide.dzi")
    dzi_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Image xmlns="http://schemas.microsoft.com/deepzoom/2008"
       Format="jpeg" Overlap="{overlap}" TileSize="{tile_size}">
  <Size Width="{width}" Height="{height}"/>
</Image>"""
    with open(dzi_path, "w") as f:
        f.write(dzi_xml)

    del levels

    return {
        "width": width,
        "height": height,
        "max_level": max_level,
        "dzi_path": dzi_path,
    }
