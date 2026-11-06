FROM python:3.14-slim

ARG DECOCTION_PIP_INDEX_URL=https://pypi.org/simple

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DECOCTION_ALLOW_DEBUG_STEP=0

WORKDIR /app

COPY requirements-lock.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    python -m pip install --disable-pip-version-check --index-url "$DECOCTION_PIP_INDEX_URL" -r requirements-lock.txt \
    && python -m pip check \
    && groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --no-create-home app

COPY app ./app

USER app
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3).close()"

# One scheduler owns this database; never add workers or replicas.
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--ws", "wsproto", "--proxy-headers", "--forwarded-allow-ips", "*"]
