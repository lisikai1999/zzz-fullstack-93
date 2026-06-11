import os
import shutil
from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session

from ..database import get_db, SLIDES_DIR
from ..models import Slide, SlideRead, SlideUpdate
from ..services.tiling import generate_dzi

router = APIRouter()


def _process_slide(slide_id: int, file_path: str):
    from ..database import SessionLocal
    db = SessionLocal()
    try:
        slide = db.query(Slide).filter(Slide.id == slide_id).first()
        if not slide:
            return

        output_dir = os.path.join(SLIDES_DIR, str(slide_id))
        os.makedirs(output_dir, exist_ok=True)

        result = generate_dzi(file_path, output_dir, slide.tile_size, slide.overlap)

        slide.width = result["width"]
        slide.height = result["height"]
        slide.dzi_path = result["dzi_path"]
        slide.status = "ready"
        db.commit()
    except Exception as e:
        slide = db.query(Slide).filter(Slide.id == slide_id).first()
        if slide:
            slide.status = f"error: {str(e)[:200]}"
            db.commit()
    finally:
        db.close()


@router.post("/", response_model=SlideRead)
async def upload_slide(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    display_name: str = Form(None),
    um_per_pixel: float = Form(None),
    db: Session = Depends(get_db),
):
    slide = Slide(
        filename=file.filename,
        display_name=display_name or file.filename,
        um_per_pixel=um_per_pixel,
        status="processing",
    )
    db.add(slide)
    db.commit()
    db.refresh(slide)

    upload_dir = os.path.join(SLIDES_DIR, str(slide.id))
    os.makedirs(upload_dir, exist_ok=True)
    file_path = os.path.join(upload_dir, "original_" + file.filename)

    with open(file_path, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            f.write(chunk)

    background_tasks.add_task(_process_slide, slide.id, file_path)
    return slide


@router.get("/", response_model=list[SlideRead])
def list_slides(db: Session = Depends(get_db)):
    return db.query(Slide).order_by(Slide.id.desc()).all()


@router.get("/{slide_id}", response_model=SlideRead)
def get_slide(slide_id: int, db: Session = Depends(get_db)):
    slide = db.query(Slide).filter(Slide.id == slide_id).first()
    if not slide:
        raise HTTPException(404, "Slide not found")
    return slide


@router.patch("/{slide_id}", response_model=SlideRead)
def update_slide(slide_id: int, data: SlideUpdate, db: Session = Depends(get_db)):
    slide = db.query(Slide).filter(Slide.id == slide_id).first()
    if not slide:
        raise HTTPException(404, "Slide not found")
    if data.display_name is not None:
        slide.display_name = data.display_name
    if data.um_per_pixel is not None:
        slide.um_per_pixel = data.um_per_pixel
    db.commit()
    db.refresh(slide)
    return slide


@router.delete("/{slide_id}")
def delete_slide(slide_id: int, db: Session = Depends(get_db)):
    slide = db.query(Slide).filter(Slide.id == slide_id).first()
    if not slide:
        raise HTTPException(404, "Slide not found")
    slide_dir = os.path.join(SLIDES_DIR, str(slide_id))
    if os.path.isdir(slide_dir):
        shutil.rmtree(slide_dir)
    db.delete(slide)
    db.commit()
    return {"ok": True}


@router.get("/{slide_id}/dzi")
def get_dzi(slide_id: int, db: Session = Depends(get_db)):
    slide = db.query(Slide).filter(Slide.id == slide_id).first()
    if not slide or not slide.dzi_path:
        raise HTTPException(404, "DZI not available")
    from fastapi.responses import FileResponse
    return FileResponse(slide.dzi_path, media_type="application/xml")
