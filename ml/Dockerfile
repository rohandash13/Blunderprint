FROM python:3.11-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
COPY pyproject.toml .
COPY src ./src
RUN pip install --no-cache-dir .
COPY checkpoints/cnn.pt /app/checkpoints/cnn.pt
ENV MODEL_CKPT=/app/checkpoints/cnn.pt
EXPOSE 8000
CMD uvicorn blunderprint_ml.service:app --host 0.0.0.0 --port ${PORT:-8000}
