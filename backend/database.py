import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

SLIDES_DIR = os.path.join(os.path.dirname(__file__), "slides_data")
os.makedirs(SLIDES_DIR, exist_ok=True)

DB_PATH = os.path.join(os.path.dirname(__file__), "pathology.db")
engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    with engine.connect() as conn:
        conn.execute(__import__("sqlalchemy").text("PRAGMA journal_mode=WAL"))
        conn.commit()
    Base.metadata.create_all(bind=engine)
