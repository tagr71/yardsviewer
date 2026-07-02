# syntax=docker/dockerfile:1.7
#
# Multi-stage build for yardsviewer.
#
#   Stage 1 (web)     — Node 20: install JS deps + run `vite build`.
#                       Output ends up at /web/dist.
#   Stage 2 (runtime) — Python 3.12: install backend deps, copy the
#                       FastAPI source and the pre-built SPA bundle, and
#                       run uvicorn on $PORT (default 8000).
#
# Build:
#     docker build -t rotvoll:latest .
#
# Run (with optional .env for RACERESULT_EVENT_ID etc.):
#     docker run --rm -p 8000:8000 --env-file backend/.env rotvoll:latest
#
# Then open http://localhost:8000.

# ---------------------------------------------------------------------------
# Stage 1 — build the Vite/React bundle
# ---------------------------------------------------------------------------
FROM node:20-alpine AS web
WORKDIR /web

# Install deps with the lockfile only first so this layer caches when
# package.json/package-lock.json haven't changed.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy the rest of the frontend and build.
COPY frontend/ ./
RUN npm run build
# `npm run build` runs `tsc -b && vite build`; output → /web/dist

# ---------------------------------------------------------------------------
# Stage 2 — Python runtime
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8000

WORKDIR /app

# Install only the runtime Python deps (kept in sync with pyproject.toml's
# [project].dependencies). Pinning here keeps the image reproducible and
# avoids needing a build backend at install time.
RUN pip install --no-cache-dir \
        "fastapi==0.139.0" \
        "uvicorn[standard]==0.49.0" \
        "httpx==0.28.1" \
        "python-dotenv==1.2.2" \
        "truststore>=0.9.2"

# Backend source.
COPY backend/ ./backend/

# Pre-built SPA from stage 1.
COPY --from=web /web/dist ./frontend/dist

# Drop privileges. Slim images don't ship a non-root user by default.
RUN useradd --create-home --shell /bin/sh app \
    && chown -R app:app /app
USER app

EXPOSE 8000

# Single-origin deployment: FastAPI serves /api/* AND the SPA bundle.
# Host 0.0.0.0 so the container is reachable; honour $PORT so PaaS
# hosts that assign a port at runtime (Cloud Run, Render, Fly) work
# out of the box.
CMD ["sh", "-c", "uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port ${PORT}"]
