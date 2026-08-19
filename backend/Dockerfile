FROM python:3.12-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app

EXPOSE 8000
# Cloud Run injects PORT (8080 by default) and probes it; a hardcoded port fails the
# startup probe and the revision never serves. Local runs keep 8000 via the fallback.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
