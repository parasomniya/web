// models.js
const { z } = require('zod');

const TelemetryDataSchema = z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    weight: z.number().min(0),
    timestamp: z.string().transform((str) => new Date(str)).default(() => new Date()),
});

const BatchReportSchema = z.object({
    batch_id: z.number(),
    start_time: z.date(),
    end_time: z.date(),
    W0: z.number(),
    W_final: z.number(),
    feeds: z.record(z.string(), z.number()),
    total_loaded: z.number(),
    violations: z.array(z.string()).optional(), // Нарушения могут быть и в отчете
});

// Обновленная схема статуса с полем violations
const BatchStatusSchema = z.object({
    is_active: z.boolean(),
    current_weight: z.number(),
    initial_weight_W0: z.number().nullable(),
    batch_start_time: z.date().nullable(),
    feeds: z.record(z.string(), z.number()),
    message: z.string(),
    violations: z.array(z.string()), // <-- Добавлено
});

module.exports = {
    TelemetryDataSchema,
    BatchReportSchema,
    BatchStatusSchema
};