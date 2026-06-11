import json
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import numpy as np
import cv2

from ..database import get_db
from ..models import (
    Annotation, Measurement, Comparison, Slide,
    AnnotationCreate, AnnotationRead, CompareRequest, CompareResult, MeasureRequest,
)
from ..services.measurement import compute_measurements

router = APIRouter()


def _build_measurement(ann_id: int, geometry: dict, tool_type: str, um_per_pixel: float | None) -> Measurement:
    m = compute_measurements(geometry, tool_type, um_per_pixel)
    return Measurement(
        annotation_id=ann_id,
        area_px=m.get("area_px", 0),
        area_um2=m.get("area_um2"),
        perimeter_px=m.get("perimeter_px", 0),
        perimeter_um=m.get("perimeter_um"),
        equiv_diameter_um=m.get("equiv_diameter_um"),
        max_feret_px=m.get("max_feret_px"),
        max_feret_um=m.get("max_feret_um"),
        min_feret_px=m.get("min_feret_px"),
        min_feret_um=m.get("min_feret_um"),
        compactness=m.get("compactness"),
        solidity=m.get("solidity"),
        convex_area_px=m.get("convex_area_px"),
        length_px=m.get("length_px"),
        length_um=m.get("length_um"),
    )


@router.post("/")
def create_annotation(data: AnnotationCreate, db: Session = Depends(get_db)):
    slide = db.query(Slide).filter(Slide.id == data.slide_id).first()
    if not slide:
        raise HTTPException(404, "Slide not found")

    ann = Annotation(
        slide_id=data.slide_id,
        annotator=data.annotator,
        label=data.label,
        tool_type=data.tool_type,
        geometry=json.dumps(data.geometry),
        layer=data.layer,
        color=data.color,
    )
    db.add(ann)
    db.commit()
    db.refresh(ann)

    meas = _build_measurement(ann.id, data.geometry, data.tool_type, slide.um_per_pixel)
    db.add(meas)
    db.commit()

    return _serialize_annotation(ann, meas)


@router.get("/")
def list_annotations(slide_id: int, layer: int = None, db: Session = Depends(get_db)):
    q = db.query(Annotation).filter(Annotation.slide_id == slide_id)
    if layer is not None:
        q = q.filter(Annotation.layer == layer)
    annotations = q.order_by(Annotation.id).all()
    return [_serialize_annotation(a, a.measurement) for a in annotations]


@router.get("/{ann_id}")
def get_annotation(ann_id: int, db: Session = Depends(get_db)):
    ann = db.query(Annotation).filter(Annotation.id == ann_id).first()
    if not ann:
        raise HTTPException(404, "Annotation not found")
    return _serialize_annotation(ann, ann.measurement)


@router.put("/{ann_id}")
def update_annotation(ann_id: int, data: AnnotationCreate, db: Session = Depends(get_db)):
    ann = db.query(Annotation).filter(Annotation.id == ann_id).first()
    if not ann:
        raise HTTPException(404, "Annotation not found")

    slide = db.query(Slide).filter(Slide.id == ann.slide_id).first()

    ann.annotator = data.annotator
    ann.label = data.label
    ann.tool_type = data.tool_type
    ann.geometry = json.dumps(data.geometry)
    ann.layer = data.layer
    ann.color = data.color
    ann.updated_at = datetime.now(timezone.utc).isoformat()

    if ann.measurement:
        db.delete(ann.measurement)
        db.flush()

    meas = _build_measurement(ann.id, data.geometry, data.tool_type, slide.um_per_pixel if slide else None)
    db.add(meas)
    db.commit()
    db.refresh(ann)

    return _serialize_annotation(ann, meas)


@router.delete("/{ann_id}")
def delete_annotation(ann_id: int, db: Session = Depends(get_db)):
    ann = db.query(Annotation).filter(Annotation.id == ann_id).first()
    if not ann:
        raise HTTPException(404, "Annotation not found")
    db.delete(ann)
    db.commit()
    return {"ok": True}


@router.post("/recalculate/{slide_id}")
def recalculate_measurements(slide_id: int, db: Session = Depends(get_db)):
    """Batch recalculate all measurements for a slide (after calibration change)."""
    slide = db.query(Slide).filter(Slide.id == slide_id).first()
    if not slide:
        raise HTTPException(404, "Slide not found")

    annotations = db.query(Annotation).filter(Annotation.slide_id == slide_id).all()
    updated = 0

    for ann in annotations:
        if ann.measurement:
            db.delete(ann.measurement)

    db.flush()

    for ann in annotations:
        geometry = json.loads(ann.geometry)
        meas = _build_measurement(ann.id, geometry, ann.tool_type, slide.um_per_pixel)
        db.add(meas)
        updated += 1

    db.commit()
    return {"ok": True, "updated": updated}


@router.post("/compare", response_model=CompareResult)
def compare_annotations(data: CompareRequest, db: Session = Depends(get_db)):
    ann_a = db.query(Annotation).filter(Annotation.id == data.annotation_a_id).first()
    ann_b = db.query(Annotation).filter(Annotation.id == data.annotation_b_id).first()
    if not ann_a or not ann_b:
        raise HTTPException(404, "Annotation not found")
    if ann_a.tool_type == "line" or ann_b.tool_type == "line":
        raise HTTPException(400, "Cannot compare line annotations")

    geom_a = json.loads(ann_a.geometry)
    geom_b = json.loads(ann_b.geometry)
    coords_a = geom_a.get("coordinates", [])
    coords_b = geom_b.get("coordinates", [])

    if len(coords_a) < 3 or len(coords_b) < 3:
        raise HTTPException(400, "Polygons must have at least 3 points")

    result = _compute_iou(coords_a, coords_b)
    comp = Comparison(
        annotation_a_id=data.annotation_a_id,
        annotation_b_id=data.annotation_b_id,
        iou=result["iou"],
        dice=result["dice"],
    )
    db.add(comp)
    db.commit()

    return result


@router.post("/measure")
def measure(data: MeasureRequest):
    return compute_measurements(data.geometry, data.tool_type, data.um_per_pixel)


def _compute_iou(coords_a: list, coords_b: list) -> dict:
    all_pts = np.array(coords_a + coords_b)
    x_min, y_min = all_pts.min(axis=0).astype(int)
    x_max, y_max = all_pts.max(axis=0).astype(int)

    w = x_max - x_min + 1
    h = y_max - y_min + 1

    scale = 1.0
    if max(w, h) > 4096:
        scale = 4096.0 / max(w, h)
        w = int(w * scale)
        h = int(h * scale)

    pts_a = ((np.array(coords_a) - [x_min, y_min]) * scale).astype(np.int32)
    pts_b = ((np.array(coords_b) - [x_min, y_min]) * scale).astype(np.int32)

    mask_a = np.zeros((h, w), dtype=np.uint8)
    mask_b = np.zeros((h, w), dtype=np.uint8)
    cv2.fillPoly(mask_a, [pts_a], 1)
    cv2.fillPoly(mask_b, [pts_b], 1)

    intersection = int(np.count_nonzero(mask_a & mask_b))
    union = int(np.count_nonzero(mask_a | mask_b))
    area_a = int(np.count_nonzero(mask_a))
    area_b = int(np.count_nonzero(mask_b))

    if scale != 1.0:
        factor = 1.0 / (scale * scale)
        intersection = int(intersection * factor)
        union = int(union * factor)
        area_a = int(area_a * factor)
        area_b = int(area_b * factor)

    iou = intersection / max(union, 1)
    dice = (2 * intersection) / max(area_a + area_b, 1)

    return {
        "iou": round(iou, 4),
        "dice": round(dice, 4),
        "intersection_px": intersection,
        "union_px": union,
        "area_a_px": area_a,
        "area_b_px": area_b,
    }


def _serialize_annotation(ann: Annotation, meas: Measurement | None) -> dict:
    result = {
        "id": ann.id,
        "slide_id": ann.slide_id,
        "annotator": ann.annotator,
        "label": ann.label,
        "tool_type": ann.tool_type,
        "geometry": json.loads(ann.geometry),
        "layer": ann.layer,
        "color": ann.color,
        "created_at": ann.created_at,
        "updated_at": ann.updated_at,
    }
    if meas:
        result["measurement"] = {
            "area_px": meas.area_px,
            "area_um2": meas.area_um2,
            "perimeter_px": meas.perimeter_px,
            "perimeter_um": meas.perimeter_um,
            "equiv_diameter_um": meas.equiv_diameter_um,
            "max_feret_px": meas.max_feret_px,
            "max_feret_um": meas.max_feret_um,
            "min_feret_px": meas.min_feret_px,
            "min_feret_um": meas.min_feret_um,
            "compactness": meas.compactness,
            "solidity": meas.solidity,
            "convex_area_px": meas.convex_area_px,
            "length_px": meas.length_px,
            "length_um": meas.length_um,
        }
    return result
