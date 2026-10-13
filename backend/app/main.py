"""ASGI entry point: ``uvicorn app.main:app``. All wiring lives in ``app.factory.create_app``."""

from app.factory import create_app

app = create_app()
