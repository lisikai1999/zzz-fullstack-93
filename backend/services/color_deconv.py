import numpy as np
import cv2


HE_STAIN_MATRIX = np.array([
    [0.6500286, 0.7040040, 0.2859691],
    [0.07211608, 0.99023440, 0.10507120],
    [0.26862988, 0.57031877, 0.77642520],
])


def _normalize_rows(matrix: np.ndarray) -> np.ndarray:
    norms = np.sqrt((matrix ** 2).sum(axis=1, keepdims=True))
    return matrix / norms


def color_deconvolution(rgb_image: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Separate H&E stains from an RGB image.
    Returns (hematoxylin, eosin, residual) as uint8 images.
    Dark = more stain.
    """
    img = rgb_image.astype(np.float64) + 1.0
    od = -np.log10(img / 256.0)

    M = _normalize_rows(HE_STAIN_MATRIX)
    M_inv = np.linalg.inv(M)

    h, w, _ = od.shape
    od_flat = od.reshape(-1, 3)
    stains = od_flat @ M_inv.T

    stains = np.clip(stains, 0, None)

    channels = []
    for i in range(3):
        channel = stains[:, i].copy()
        max_val = np.percentile(channel, 99)
        if max_val > 0:
            channel = channel / max_val
        channel = np.clip(channel, 0, 1)
        out = (255 * (1 - channel)).reshape(h, w).astype(np.uint8)
        channels.append(out)

    return channels[0], channels[1], channels[2]


def compute_nc_ratio(rgb_roi: np.ndarray) -> dict:
    """Compute nuclear-cytoplasmic ratio within an ROI."""
    hematoxylin, eosin, _ = color_deconvolution(rgb_roi)

    inverted = 255 - hematoxylin
    _, nuclear_mask = cv2.threshold(inverted, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    gray = cv2.cvtColor(rgb_roi, cv2.COLOR_RGB2GRAY)
    _, tissue_mask = cv2.threshold(gray, 220, 255, cv2.THRESH_BINARY_INV)

    nuclear_area = int(np.count_nonzero(nuclear_mask & tissue_mask))
    tissue_area = int(np.count_nonzero(tissue_mask))
    cytoplasm_area = tissue_area - nuclear_area

    nc_ratio = nuclear_area / max(cytoplasm_area, 1)

    return {
        "nuclear_area_px": nuclear_area,
        "cytoplasm_area_px": cytoplasm_area,
        "tissue_area_px": tissue_area,
        "nc_ratio": round(nc_ratio, 4),
    }


def deconvolve_tile(tile_bgr: np.ndarray, channel: str) -> np.ndarray:
    """Apply color deconvolution to a single tile, return the specified channel."""
    rgb = cv2.cvtColor(tile_bgr, cv2.COLOR_BGR2RGB)
    h_ch, e_ch, r_ch = color_deconvolution(rgb)
    mapping = {"hematoxylin": h_ch, "eosin": e_ch, "residual": r_ch}
    result = mapping.get(channel, h_ch)
    return cv2.cvtColor(result, cv2.COLOR_GRAY2BGR)
