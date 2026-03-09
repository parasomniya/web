from typing import Dict, Tuple
from enum import Enum

class FeedType(str, Enum):
    CORN = "corn"
    WHEAT = "wheat"
    SOY = "soy"
    UNKNOWN = "unknown"

# Зоны загрузки: название -> (центр, радиус в метрах)
LOADING_ZONES: Dict[FeedType, Dict] = {
    FeedType.CORN: {"center": (55.7558, 37.6173), "radius": 100},
    FeedType.WHEAT: {"center": (55.7658, 37.6273), "radius": 100},
    FeedType.SOY: {"center": (55.7458, 37.6073), "radius": 100},
}

# Зона выгрузки
UNLOAD_ZONE: Dict = {"center": (55.7358, 37.5973), "radius": 100}

# Пороги
WEIGHT_THRESHOLD_W = 100.0  # кг - начало Batch
BATCH_END_DELAY = 600       # секунд (10 минут)
WEIGHT_EPSILON = 0.5        # кг - погрешность весов