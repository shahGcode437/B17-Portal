# B-17 Portal API image (production-oriented). Build context: backend/
#
#   docker build -t b17-portal-api backend
#   docker run --rm -p 8000:8000 -e DATABASE_URL=... -e FRONTEND_ORIGINS=https://app.example.org b17-portal-api
#
# - Runtime dependencies only (no pytest/ruff/mypy), installed from pyproject.toml.
# - Runs as a non-root user; no .env, no secrets and no tests are copied in.
# - PostgreSQL is NOT part of this image: point DATABASE_URL at a managed/Compose database.
# - Migrations are an explicit release step, not run on boot:
#     docker run --rm -e DATABASE_URL=... b17-portal-api alembic upgrade head
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    ENVIRONMENT=production

WORKDIR /app

# 1) Third-party dependencies first: this layer is rebuilt only when pyproject.toml changes.
COPY pyproject.toml ./
RUN python -c "import tomllib; print('\n'.join(tomllib.load(open('pyproject.toml', 'rb'))['project']['dependencies']))" > /tmp/requirements.txt \
    && pip install -r /tmp/requirements.txt \
    && rm /tmp/requirements.txt

# 2) Application code, migrations and their config.
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./
RUN pip install --no-deps . && rm -rf build ./*.egg-info

RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin b17
USER b17

EXPOSE 8000

# Liveness only (never depends on the database): the same endpoint orchestrators should probe.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request, sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=2).status == 200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
