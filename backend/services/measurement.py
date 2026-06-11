import math
import numpy as np


def polygon_area_px(coords: list) -> float:
    n = len(coords)
    if n < 3:
        return 0.0
    area = 0.0
    for i in range(n):
        j = (i + 1) % n
        area += coords[i][0] * coords[j][1]
        area -= coords[j][0] * coords[i][1]
    return abs(area) / 2.0


def polygon_perimeter_px(coords: list) -> float:
    n = len(coords)
    if n < 2:
        return 0.0
    total = 0.0
    for i in range(n):
        j = (i + 1) % n
        dx = coords[j][0] - coords[i][0]
        dy = coords[j][1] - coords[i][1]
        total += math.sqrt(dx * dx + dy * dy)
    return total


def line_length_px(p1: list, p2: list) -> float:
    dx = p2[0] - p1[0]
    dy = p2[1] - p1[1]
    return math.sqrt(dx * dx + dy * dy)


def equivalent_diameter(area_um2: float) -> float:
    if area_um2 <= 0:
        return 0.0
    return 2.0 * math.sqrt(area_um2 / math.pi)


def convex_hull(points: list) -> list:
    """Andrew's monotone chain convex hull. Returns hull points in CCW order."""
    pts = sorted(points, key=lambda p: (p[0], p[1]))
    if len(pts) <= 2:
        return pts

    lower = []
    for p in pts:
        while len(lower) >= 2 and _cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)

    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and _cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)

    return lower[:-1] + upper[:-1]


def _cross(o, a, b):
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])


def max_feret_diameter(coords: list) -> float:
    """Maximum caliper distance (longest distance between any two hull points)."""
    hull = convex_hull(coords)
    if len(hull) < 2:
        return 0.0
    max_dist = 0.0
    n = len(hull)
    for i in range(n):
        for j in range(i + 1, n):
            dx = hull[j][0] - hull[i][0]
            dy = hull[j][1] - hull[i][1]
            d = math.sqrt(dx * dx + dy * dy)
            if d > max_dist:
                max_dist = d
    return max_dist


def min_feret_diameter(coords: list) -> float:
    """Minimum caliper distance (shortest width across the convex hull)."""
    hull = convex_hull(coords)
    n = len(hull)
    if n < 3:
        if n == 2:
            return 0.0
        return 0.0

    min_width = float('inf')
    for i in range(n):
        j = (i + 1) % n
        ex = hull[j][0] - hull[i][0]
        ey = hull[j][1] - hull[i][1]
        edge_len = math.sqrt(ex * ex + ey * ey)
        if edge_len == 0:
            continue
        nx = -ey / edge_len
        ny = ex / edge_len

        min_proj = float('inf')
        max_proj = float('-inf')
        for k in range(n):
            proj = hull[k][0] * nx + hull[k][1] * ny
            min_proj = min(min_proj, proj)
            max_proj = max(max_proj, proj)
        width = max_proj - min_proj
        min_width = min(min_width, width)

    return min_width if min_width != float('inf') else 0.0


def compactness(area: float, perimeter: float) -> float:
    """Compactness = 4*pi*area / perimeter^2. Circle = 1.0."""
    if perimeter <= 0:
        return 0.0
    return (4 * math.pi * area) / (perimeter * perimeter)


def convex_area_px(coords: list) -> float:
    """Area of the convex hull."""
    hull = convex_hull(coords)
    return polygon_area_px(hull)


def solidity(area: float, convex_area: float) -> float:
    """Solidity = area / convex_hull_area. Measures how solid or how many concavities."""
    if convex_area <= 0:
        return 0.0
    return area / convex_area


def compute_measurements(geometry: dict, tool_type: str, um_per_pixel: float | None = None) -> dict:
    coords = geometry.get("coordinates", [])
    result = {}

    if tool_type == "line":
        if len(coords) >= 2:
            length = line_length_px(coords[0], coords[1])
            result["length_px"] = length
            if um_per_pixel:
                result["length_um"] = length * um_per_pixel
        return result

    if len(coords) < 3:
        return result

    area = polygon_area_px(coords)
    perimeter = polygon_perimeter_px(coords)
    feret_max = max_feret_diameter(coords)
    feret_min = min_feret_diameter(coords)
    conv_area = convex_area_px(coords)

    result["area_px"] = area
    result["perimeter_px"] = perimeter
    result["max_feret_px"] = feret_max
    result["min_feret_px"] = feret_min
    result["compactness"] = compactness(area, perimeter)
    result["solidity"] = solidity(area, conv_area)
    result["convex_area_px"] = conv_area

    if um_per_pixel:
        area_um2 = area * (um_per_pixel ** 2)
        result["area_um2"] = area_um2
        result["perimeter_um"] = perimeter * um_per_pixel
        result["equiv_diameter_um"] = equivalent_diameter(area_um2)
        result["max_feret_um"] = feret_max * um_per_pixel
        result["min_feret_um"] = feret_min * um_per_pixel

    return result
