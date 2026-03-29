// main.js
const express = require('express');
const bodyParser = require('body-parser');
const zones = require('./zones');
const currentRation = require('./current_ration');
const currentZones = require('./current_zones');

// Сначала применяем начальные (тестовые) данные, чтобы tracker собрал корректные ключи FeedType.
zones.applyRation(currentRation, currentZones);

const { tracker } = require('./tracker');
const { TelemetryDataSchema, BatchStatusSchema, BatchReportSchema } = require('./models');
const { ZodError } = require('zod');

const app = express();
const PORT = 3000;

app.use(bodyParser.json());

// Middleware для обработки ошибок валидации
const validate = (schema) => (req, res, next) => {
    try {
        // Поддерживаем оба формата входа:
        // 1) lat/lon (как в эмуляторе и твоём примере)
        // 2) latitude/longitude (старый/альтернативный контракт)
        if (req.body && req.body.lat !== undefined && req.body.latitude === undefined) {
            req.body.latitude = req.body.lat;
        }
        if (req.body && req.body.lon !== undefined && req.body.longitude === undefined) {
            req.body.longitude = req.body.lon;
        }
        if (req.body && req.body.latitude !== undefined && req.body.lat === undefined) {
            req.body.lat = req.body.latitude;
        }
        if (req.body && req.body.longitude !== undefined && req.body.lon === undefined) {
            req.body.lon = req.body.longitude;
        }

        const parsed = schema.parse(req.body);
        // Дальше логика использует lat/lon, поэтому приводим результат к этому формату.
        if (parsed && parsed.lat === undefined && parsed.latitude !== undefined) {
            parsed.lat = parsed.latitude;
        }
        if (parsed && parsed.lon === undefined && parsed.longitude !== undefined) {
            parsed.lon = parsed.longitude;
        }

        req.validatedData = parsed;
        next();
    } catch (err) {
        if (err instanceof ZodError) {
            return res.status(400).json({ error: "Validation failed", details: err.errors });
        }
        next(err);
    }
};

// POST /telemetry
app.post('/api/telemetry/host', validate(TelemetryDataSchema), (req, res) => {
    const { lat, lon, weight, timestamp } = req.validatedData;
    
    const result = tracker.processTelemetry(lat, lon, weight, timestamp);
    res.json(result);
});

// GET /batch/status
app.get('/batch/status', (req, res) => {
    const status = tracker.getCurrentStatus();
    
    if (!status.is_active) {
        return res.status(404).json({ detail: "Нет активного Batch" });
    }
    
    res.json(status);
});

// GET /batch/history
app.get('/batch/history', (req, res) => {
    const history = tracker.getBatchHistory();
    
    if (history.length === 0) {
        return res.status(404).json({ detail: "История пуста" });
    }
    
    res.json(history);
});

// GET /batch/last
app.get('/batch/last', (req, res) => {
    const last = tracker.getLastBatch();
    
    if (!last) {
        return res.status(404).json({ detail: "Нет завершённых Batch" });
    }
    
    res.json(last);
});

// GET /health
app.get('/health', (req, res) => {
    res.json({
        status: "ok",
        timestamp: new Date().toISOString()
    });
});

function rationFingerprint(ration) {
    const ingredients = Array.isArray(ration?.ingredients) ? ration.ingredients : [];
    const normalized = ingredients
        .map((i) => ({
            id: i.id,
            name: i.name,
            plannedWeight: Number(i.plannedWeight),
        }))
        .sort((a, b) => Number(a.id) - Number(b.id));

    return JSON.stringify({
        rationId: ration?.id,
        ingredients: normalized,
    });
}

function zonesFingerprint(zonesArr) {
    const list = Array.isArray(zonesArr) ? zonesArr : [];
    const normalized = list
        .map((z) => ({
            id: z.id,
            ingredient: z.ingredient,
            name: z.name,
            lat: Number(z.lat),
            lon: Number(z.lon),
            radius: Number(z.radius),
            active: z.active,
        }))
        .sort((a, b) => Number(a.id) - Number(b.id));

    return JSON.stringify(normalized);
}

async function fetchJson(url, headers) {
    const res = await fetch(url, { headers });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new Error(`HTTP ${res.status} ${url}. ${text.slice(0, 120)}`);
        err.status = res.status;
        throw err;
    }
    return res.json();
}

async function fetchLatestRation(baseUrl, headers) {
    // Основной путь по твоему ТЗ
    try {
        const data = await fetchJson(`${baseUrl}/api/rations/`, headers);
        // На всякий: иногда роут может завернуть в {ration: ...}
        return data?.ration ? data.ration : data;
    } catch (e) {
        if (e.status !== 404) throw e;
    }

    // Fallback: GET /api/rations (последний по createdAt)
    const rations = await fetchJson(`${baseUrl}/api/rations`, headers);
    if (!Array.isArray(rations) || rations.length === 0) return null;

    const sorted = [...rations].sort((a, b) => {
        const ta = new Date(a.createdAt || a.created_at || 0).getTime();
        const tb = new Date(b.createdAt || b.created_at || 0).getTime();
        return tb - ta;
    });
    return sorted[0] || null;
}

// Запуск сервера
if (require.main === module) {
    const baseUrl = process.env.OPD_API_BASE || 'http://localhost:3000';
    const intervalMs = parseInt(process.env.CONFIG_SYNC_MS || '60000', 10);
    const token = process.env.OPD_API_TOKEN;
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    let lastRationFp = rationFingerprint(currentRation);
    let lastZonesFp = zonesFingerprint(currentZones);

    async function syncConfigTick() {
        const ration = await fetchLatestRation(baseUrl, headers);
        const zonesList = await fetchJson(`${baseUrl}/api/telemetry/zones`, headers);

        const newRationFp = rationFingerprint(ration);
        const newZonesFp = zonesFingerprint(zonesList);

        if (newRationFp === lastRationFp && newZonesFp === lastZonesFp) {
            return;
        }

        // Обновляем "текущие" объекты на месте (чтобы остался один и тот же reference).
        for (const k of Object.keys(currentRation)) delete currentRation[k];
        Object.assign(currentRation, ration || {});

        currentZones.length = 0;
        if (Array.isArray(zonesList)) currentZones.push(...zonesList);

        zones.applyRation(currentRation, currentZones);
        tracker.reset();

        lastRationFp = newRationFp;
        lastZonesFp = newZonesFp;
        console.log('[logicjs] Конфиг обновлён (рацион/зоны).');
    }

    // Один раз сразу + дальше раз в минуту.
    syncConfigTick()
        .catch((e) => console.warn('[logicjs] syncConfigTick:', e.message))
        .finally(() => {
            setInterval(() => {
                syncConfigTick().catch((e) => console.warn('[logicjs] syncConfigTick:', e.message));
            }, intervalMs);

            app.listen(PORT, '0.0.0.0', () => {
                console.log(`Feed Batch Tracker API running on http://0.0.0.0:${PORT}`);
            });
        });
}

module.exports = app;