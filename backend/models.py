from datetime import datetime, timezone
from typing import Optional, Literal
from sqlalchemy import Integer, Text, Float, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from pydantic import BaseModel

from .database import Base


# ─── ORM Models ───────────────────────────────────────────────────────────────

class Slide(Base):
    __tablename__ = "slides"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    filename: Mapped[str] = mapped_column(Text, nullable=False)
    display_name: Mapped[Optional[str]] = mapped_column(Text)
    width: Mapped[int] = mapped_column(Integer, default=0)
    height: Mapped[int] = mapped_column(Integer, default=0)
    um_per_pixel: Mapped[Optional[float]] = mapped_column(Float)
    tile_size: Mapped[int] = mapped_column(Integer, default=256)
    overlap: Mapped[int] = mapped_column(Integer, default=1)
    dzi_path: Mapped[Optional[str]] = mapped_column(Text)
    upload_time: Mapped[str] = mapped_column(
        Text, default=lambda: datetime.now(timezone.utc).isoformat()
    )
    status: Mapped[str] = mapped_column(Text, default="processing")

    annotations: Mapped[list["Annotation"]] = relationship(back_populates="slide", cascade="all, delete-orphan")


class Annotation(Base):
    __tablename__ = "annotations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slide_id: Mapped[int] = mapped_column(ForeignKey("slides.id"))
    annotator: Mapped[str] = mapped_column(Text, default="anonymous")
    label: Mapped[str] = mapped_column(Text, default="")
    tool_type: Mapped[str] = mapped_column(Text)
    geometry: Mapped[str] = mapped_column(Text)
    layer: Mapped[int] = mapped_column(Integer, default=0)
    color: Mapped[str] = mapped_column(Text, default="#ff0000")
    created_at: Mapped[str] = mapped_column(
        Text, default=lambda: datetime.now(timezone.utc).isoformat()
    )
    updated_at: Mapped[str] = mapped_column(
        Text, default=lambda: datetime.now(timezone.utc).isoformat()
    )

    slide: Mapped["Slide"] = relationship(back_populates="annotations")
    measurement: Mapped[Optional["Measurement"]] = relationship(back_populates="annotation", uselist=False, cascade="all, delete-orphan")


class Measurement(Base):
    __tablename__ = "measurements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    annotation_id: Mapped[int] = mapped_column(ForeignKey("annotations.id"))
    area_px: Mapped[float] = mapped_column(Float, default=0)
    area_um2: Mapped[Optional[float]] = mapped_column(Float)
    perimeter_px: Mapped[float] = mapped_column(Float, default=0)
    perimeter_um: Mapped[Optional[float]] = mapped_column(Float)
    equiv_diameter_um: Mapped[Optional[float]] = mapped_column(Float)
    max_feret_px: Mapped[Optional[float]] = mapped_column(Float)
    max_feret_um: Mapped[Optional[float]] = mapped_column(Float)
    min_feret_px: Mapped[Optional[float]] = mapped_column(Float)
    min_feret_um: Mapped[Optional[float]] = mapped_column(Float)
    compactness: Mapped[Optional[float]] = mapped_column(Float)
    solidity: Mapped[Optional[float]] = mapped_column(Float)
    convex_area_px: Mapped[Optional[float]] = mapped_column(Float)
    length_px: Mapped[Optional[float]] = mapped_column(Float)
    length_um: Mapped[Optional[float]] = mapped_column(Float)
    computed_at: Mapped[str] = mapped_column(
        Text, default=lambda: datetime.now(timezone.utc).isoformat()
    )

    annotation: Mapped["Annotation"] = relationship(back_populates="measurement")


class Comparison(Base):
    __tablename__ = "comparisons"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    annotation_a_id: Mapped[int] = mapped_column(ForeignKey("annotations.id"))
    annotation_b_id: Mapped[int] = mapped_column(ForeignKey("annotations.id"))
    iou: Mapped[float] = mapped_column(Float)
    dice: Mapped[float] = mapped_column(Float)
    computed_at: Mapped[str] = mapped_column(
        Text, default=lambda: datetime.now(timezone.utc).isoformat()
    )


# ─── Pydantic Schemas ─────────────────────────────────────────────────────────

class SlideCreate(BaseModel):
    display_name: Optional[str] = None
    um_per_pixel: Optional[float] = None


class SlideUpdate(BaseModel):
    display_name: Optional[str] = None
    um_per_pixel: Optional[float] = None


class SlideRead(BaseModel):
    id: int
    filename: str
    display_name: Optional[str]
    width: int
    height: int
    um_per_pixel: Optional[float]
    tile_size: int
    overlap: int
    dzi_path: Optional[str]
    upload_time: str
    status: str

    class Config:
        from_attributes = True


class AnnotationCreate(BaseModel):
    slide_id: int
    annotator: str = "anonymous"
    label: str = ""
    tool_type: Literal["freehand", "polygon", "line"]
    geometry: dict
    layer: int = 0
    color: str = "#ff0000"


class AnnotationRead(BaseModel):
    id: int
    slide_id: int
    annotator: str
    label: str
    tool_type: str
    geometry: dict
    layer: int
    color: str
    created_at: str
    measurement: Optional[dict] = None

    class Config:
        from_attributes = True


class CompareRequest(BaseModel):
    annotation_a_id: int
    annotation_b_id: int


class CompareResult(BaseModel):
    iou: float
    dice: float
    intersection_px: int
    union_px: int
    area_a_px: int
    area_b_px: int


class NuclearRatioRequest(BaseModel):
    roi: Optional[dict] = None


class MeasureRequest(BaseModel):
    geometry: dict
    um_per_pixel: Optional[float] = None
    tool_type: Literal["freehand", "polygon", "line"]
