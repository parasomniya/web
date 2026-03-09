from pydantic import BaseModel, Field
from datetime import datetime
from typing import Dict, Optional, Tuple
from zones import FeedType

class TelemetryData(BaseModel):
    """Данные телеметрии от сервера"""
    latitude: float = Field(..., ge=-90, le=90, description="Широта")
    longitude: float = Field(..., ge=-180, le=180, description="Долгота")
    weight: float = Field(..., ge=0, description="Вес в кузове (кг)")
    timestamp: datetime = Field(default_factory=datetime.now, description="Время замера")

class BatchReport(BaseModel):
    """Отчёт по завершённому Batch"""
    batch_id: int
    start_time: datetime
    end_time: datetime
    W0: float
    W_final: float
    feeds: Dict[str, float]
    total_loaded: float

class BatchStatus(BaseModel):
    """Текущий статус Batch"""
    is_active: bool
    current_weight: float
    initial_weight_W0: Optional[float]
    batch_start_time: Optional[datetime]
    feeds: Dict[str, float]
    message: str