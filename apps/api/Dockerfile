FROM python:3.11-slim

WORKDIR /app

COPY apps/api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/api/app/ app/
COPY apps/api/main.py .

EXPOSE 3000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "3000"]
