from fastapi import FastAPI, HTTPException
from models import TelemetryData, BatchReport, BatchStatus
from tracker import tracker
from datetime import datetime
from typing import List, Optional

app = FastAPI(
    title="Feed Batch Tracker API",
    description="Система отслеживания загрузки кормов в кузов",
    version="1.0.0"
)

@app.post("/telemetry", summary="Отправить данные телеметрии")
def send_telemetry(data: TelemetryData):
    """
    Принимает данные о местоположении, весе и времени.
    Автоматически определяет начало/конец Batch и тип корма.
    """
    result = tracker.process_telemetry(
        lat=data.latitude,
        lon=data.longitude,
        weight=data.weight,
        timestamp=data.timestamp
    )
    return result

@app.get("/batch/status", response_model=BatchStatus, summary="Текущий статус Batch")
def get_batch_status():
    """Возвращает текущее состояние активного Batch"""
    status = tracker.get_current_status()
    if not status["is_active"]:
        raise HTTPException(status_code=404, detail="Нет активного Batch")
    return status

@app.get("/batch/history", response_model=List[BatchReport], summary="История всех Batch")
def get_batch_history():
    """Возвращает все завершённые Batch"""
    history = tracker.get_batch_history()
    if not history:
        raise HTTPException(status_code=404, detail="История пуста")
    return history

@app.get("/batch/last", response_model=BatchReport, summary="Последний завершённый Batch")
def get_last_batch():
    """Возвращает последний завершённый Batch"""
    last = tracker.get_last_batch()
    if not last:
        raise HTTPException(status_code=404, detail="Нет завершённых Batch")
    return last

@app.get("/health", summary="Проверка работоспособности")
def health_check():
    """Проверка что API работает"""
    return {"status": "ok", "timestamp": datetime.now()}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)