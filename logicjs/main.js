// main.js
const express = require('express');
const bodyParser = require('body-parser');
const { tracker } = require('./tracker');
const { TelemetryDataSchema, BatchStatusSchema, BatchReportSchema } = require('./models');
const { ZodError } = require('zod');

const app = express();
const PORT = 8000;

app.use(bodyParser.json());

// Middleware для обработки ошибок валидации
const validate = (schema) => (req, res, next) => {
    try {
        req.validatedData = schema.parse(req.body);
        next();
    } catch (err) {
        if (err instanceof ZodError) {
            return res.status(400).json({ error: "Validation failed", details: err.errors });
        }
        next(err);
    }
};

// POST /telemetry
app.post('/telemetry', validate(TelemetryDataSchema), (req, res) => {
    const { latitude, longitude, weight, timestamp } = req.validatedData;
    
    const result = tracker.processTelemetry(latitude, longitude, weight, timestamp);
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

// Запуск сервера
if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Feed Batch Tracker API running on http://0.0.0.0:${PORT}`);
    });
}

module.exports = app;