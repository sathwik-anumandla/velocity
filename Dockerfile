# ==============================================================================
# Multi-Stage Build: Compiles React frontend and bundles with FastAPI backend
# ==============================================================================

# Stage 1: Build Web Frontend Assets
FROM node:20-alpine AS frontend-builder
WORKDIR /app/web
COPY web/package*.json ./
RUN npm install
COPY web/ ./
RUN npm run build

# Stage 2: Python Backend Runtime
FROM python:3.11-slim
WORKDIR /app

# Install runtime dependencies (sqlite3, curl for healthchecks, DejaVu fonts for PDF engine)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    sqlite3 \
    fonts-dejavu-core \
    fonts-dejavu-mono \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Copy compiled frontend from builder stage into /app/web/dist
COPY --from=frontend-builder /app/web/dist /app/web/dist

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
