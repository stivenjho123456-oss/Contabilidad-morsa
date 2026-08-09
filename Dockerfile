# ── Etapa 1: build del frontend ─────────────────────────────
# El SPA se compila con VITE_API_URL vacio para que llame a la misma
# origen que lo sirve. Asi no hay CORS ni URL de backend hardcodeada.
FROM node:22-slim AS frontend

WORKDIR /build

COPY apps/frontend/package.json apps/frontend/package-lock.json ./
RUN npm ci

COPY apps/frontend/ ./
ENV VITE_API_URL=""
RUN npm run build


# ── Etapa 2: backend + SPA ──────────────────────────────────
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY apps/backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r /tmp/requirements.txt

COPY ContabilidadMorsa /app/ContabilidadMorsa
COPY apps/backend /app/apps/backend

# main.py monta apps/frontend/dist automaticamente si existe.
COPY --from=frontend /build/dist /app/apps/frontend/dist

# Railway inyecta PORT (8080 por defecto). EXPOSE deja el puerto declarado
# para que el target port del dominio coincida con el que escucha uvicorn.
EXPOSE 8080

CMD ["sh", "-c", "uvicorn apps.backend.app.main:app --host 0.0.0.0 --port ${PORT:-8080} --workers 2 --log-level info"]
