FROM python:3.12-slim

# SQLCipher system library required to decrypt exportLibrary.db
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsqlcipher-dev \
    gcc \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install the shared importer package first (brings in pyrekordbox, sqlcipher3, supabase)
COPY importer/ /tmp/importer/
RUN pip install --no-cache-dir /tmp/importer/

# Install backend dependencies
COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY backend/app/ /app/app/

# Run as non-root
RUN useradd --no-create-home appuser && chown -R appuser /app
USER appuser

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
