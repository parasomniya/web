from datetime import datetime, timedelta
from typing import Dict, Optional, Tuple, List
from zones import (
    LOADING_ZONES, UNLOAD_ZONE, 
    WEIGHT_THRESHOLD_W, BATCH_END_DELAY, WEIGHT_EPSILON,
    FeedType
)
from models import BatchReport
from math import radians, sin, cos, sqrt, atan2

def haversine_distance(coord1: Tuple[float, float], coord2: Tuple[float, float]) -> float:
    """Расстояние между двумя GPS-точками в метрах"""
    R = 6371000
    lat1, lon1 = map(radians, coord1)
    lat2, lon2 = map(radians, coord2)
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
    c = 2 * atan2(sqrt(a), sqrt(1-a))
    return R * c

def check_zone(location: Tuple[float, float], zones: Dict) -> Optional[str]:
    """Проверяет, в какой зоне находится точка"""
    for zone_name, zone_data in zones.items():
        dist = haversine_distance(location, zone_data["center"])
        if dist <= zone_data["radius"]:
            return zone_name.value if isinstance(zone_name, FeedType) else zone_name
    return None

class FeedBatchTracker:
    def __init__(self, threshold_W: float = WEIGHT_THRESHOLD_W):
        self.threshold_W = threshold_W
        self.is_batch_active = False
        self.batch_start_time: Optional[datetime] = None
        self.initial_weight_W0 = 0.0
        self.current_weight = 0.0
        self.previous_weight = 0.0
        self.previous_location: Optional[Tuple[float, float]] = None
        self.previous_timestamp: Optional[datetime] = None
        self.unload_detected_time: Optional[datetime] = None
        self.weight_stable_time: Optional[datetime] = None
        self.batch_feeds: Dict[str, float] = {}
        self.completed_batches: List[BatchReport] = []
        self.batch_counter = 0
        self.last_batch_final_weight = 0.0  

    def process_telemetry(self, lat: float, lon: float, weight: float, timestamp: datetime) -> Dict:
        """Обрабатывает данные телеметрии"""
        self.previous_weight = self.current_weight
        self.current_weight = weight
        self.previous_location = (lat, lon)
        self.previous_timestamp = timestamp
        weight_diff = weight - self.previous_weight

        # Старт Batch
        if not self.is_batch_active and weight > self.threshold_W:
            self._start_batch(weight)
            return {"status": "batch_started", "W0": self.initial_weight_W0}

        # Активный Batch
        if self.is_batch_active:
            return self._process_active_batch((lat, lon), timestamp, weight, weight_diff)

        return {"status": "waiting", "weight": weight}

    def _start_batch(self, initial_weight: float):
        self.is_batch_active = True
        self.batch_start_time = datetime.now()
        
        self.initial_weight_W0 = self.last_batch_final_weight
        
        self.batch_counter += 1
        self.batch_feeds = {
            FeedType.CORN.value: 0.0,
            FeedType.WHEAT.value: 0.0,
            FeedType.SOY.value: 0.0,
            FeedType.UNKNOWN.value: 0.0
        }
        
        weight_diff = initial_weight - self.initial_weight_W0
        if weight_diff > 0:
            # Определяем зону по последнему местоположению
            if self.previous_location:
                loading_zone = check_zone(self.previous_location, LOADING_ZONES)
                feed_type = loading_zone if loading_zone else FeedType.UNKNOWN.value
            else:
                feed_type = FeedType.UNKNOWN.value
            
            self.batch_feeds[feed_type] += weight_diff
        
        self.unload_detected_time = None
        self.weight_stable_time = None

    def _process_active_batch(self, location, timestamp, weight, weight_diff) -> Dict:
        loading_zone = check_zone(location, LOADING_ZONES)
        in_unload_zone = check_zone(location, {"unload": UNLOAD_ZONE}) is not None

        # Загрузка
        if weight_diff > WEIGHT_EPSILON:
            self.weight_stable_time = None
            feed_type = loading_zone if loading_zone else FeedType.UNKNOWN.value
            self.batch_feeds[feed_type] += weight_diff
            return {
                "status": "loading",
                "weight": weight,
                "feed_type": feed_type,
                "added": round(weight_diff, 2)
            }

        # Выгрузка
        elif weight_diff < -WEIGHT_EPSILON:
            if in_unload_zone:
                self.unload_detected_time = timestamp
                return {"status": "unloading", "weight": weight}
            else:
                return {"status": "weight_loss_warning", "weight": weight}

        # Стабилизация
        else:
            if in_unload_zone and self.unload_detected_time:
                if not self.weight_stable_time:
                    self.weight_stable_time = timestamp
                if (timestamp - self.weight_stable_time).total_seconds() >= BATCH_END_DELAY:
                    self._end_batch(weight)
                    return {"status": "batch_completed", "weight": weight}
            return {"status": "stable", "weight": weight}

    def _end_batch(self, final_weight: float):
        total_loaded = sum(self.batch_feeds.values())
        report = BatchReport(
            batch_id=self.batch_counter,
            start_time=self.batch_start_time,
            end_time=datetime.now(),
            W0=round(self.initial_weight_W0, 2),
            W_final=round(final_weight, 2),
            feeds={k: round(v, 2) for k, v in self.batch_feeds.items()},
            total_loaded=round(total_loaded, 2)
        )
        self.completed_batches.append(report)
        
        # Сохраняем остаток для следующего Batch
        self.last_batch_final_weight = final_weight
        
        self.is_batch_active = False
        self.batch_feeds = {}
        self.unload_detected_time = None
        self.weight_stable_time = None

    def get_current_status(self) -> Dict:
        return {
            "is_active": self.is_batch_active,
            "current_weight": round(self.current_weight, 2),
            "initial_weight_W0": round(self.initial_weight_W0, 2) if self.is_batch_active else None,
            "batch_start_time": self.batch_start_time,
            "feeds": {k: round(v, 2) for k, v in self.batch_feeds.items()},
            "message": "Batch активен" if self.is_batch_active else "Ожидание начала Batch"
        }

    def get_batch_history(self) -> List[BatchReport]:
        return self.completed_batches

    def get_last_batch(self) -> Optional[BatchReport]:
        return self.completed_batches[-1] if self.completed_batches else None

# Глобальный экземпляр трекера
tracker = FeedBatchTracker()