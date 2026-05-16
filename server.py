"""Entry point: start the FastAPI backend via uvicorn.

Run with:
    uv run python .\\server.py
"""
from __future__ import annotations

import uvicorn


def main() -> None:
    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        app_dir="backend",
    )


if __name__ == "__main__":
    main()
