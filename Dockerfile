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

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
