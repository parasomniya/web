import prisma from '../../database.js';
import { aggregateFacts, getBatchPlan } from '../batches/batch-violations.js';

export const DEFAULT_LIMIT = 500;
export const MAX_LIMIT = 1000;
export const VIOLATION_THRESHOLD = 10;

function round1(value) {
    return Math.round(Number(value || 0) * 10) / 10;
}

export function parsePositiveInt(value, fallback) {
    const parsed = parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseDateBoundary(value, kind) {
    if (!value) return null;

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return { error: `Некорректная дата параметра ${kind}` };
    }

    if (kind === 'from') {
        parsed.setHours(0, 0, 0, 0);
    } else {
        parsed.setHours(23, 59, 59, 999);
    }

    return parsed;
}

function buildBatchDate(batch) {
    return batch.endTime || batch.startTime || null;
}

function toUiViolationStatus(violation) {
    if (violation.status === 'CLOSED') return 'closed';
    if (violation.status === 'IN_PROGRESS') return 'in_progress';

    const deviationPercent = Math.abs(Number(violation?.deviationPercent || 0));
    if (violation.code === 'MISSING_COMPONENT' || violation.code === 'EXTRA_COMPONENT' || violation.code === 'LEFTOVER_WEIGHT' || deviationPercent >= 20) {
        return 'critical';
    }

    return 'open';
}

export async function collectReportData({ fromDate = null, toDate = null, limit = DEFAULT_LIMIT } = {}) {
    const where = {};

    if (fromDate || toDate) {
        where.startTime = {
            ...(fromDate ? { gte: fromDate } : {}),
            ...(toDate ? { lte: toDate } : {})
        };
    }

    const batches = await prisma.batch.findMany({
        where,
        include: {
            group: {
                select: {
                    id: true,
                    name: true,
                    headcount: true
                }
            },
            ration: {
                select: {
                    id: true,
                    name: true,
                    ingredients: {
                        select: {
                            id: true,
                            name: true,
                            plannedWeight: true,
                            dryMatterWeight: true
                        }
                    }
                }
            },
            actualIngredients: {
                select: {
                    id: true,
                    ingredientName: true,
                    plannedWeight: true,
                    actualWeight: true,
                    isViolation: true,
                    addedAt: true
                },
                orderBy: { addedAt: 'asc' }
            },
            violations: {
                where: {
                    status: { not: 'RESOLVED' }
                },
                select: {
                    id: true
                }
            }
        },
        orderBy: { startTime: 'desc' },
        take: Math.min(limit, MAX_LIMIT)
    });

    const violations = await prisma.violation.findMany({
        where: {
            ...(fromDate || toDate ? {
                detectedAt: {
                    ...(fromDate ? { gte: fromDate } : {}),
                    ...(toDate ? { lte: toDate } : {})
                }
            } : {}),
            status: { not: 'RESOLVED' }
        },
        include: {
            batch: {
                include: {
                    group: {
                        select: {
                            id: true,
                            name: true
                        }
                    }
                }
            }
        },
        orderBy: { detectedAt: 'desc' },
        take: Math.min(limit, MAX_LIMIT)
    });

    const reportBatches = [];
    const reportViolations = [];

    for (const batch of batches) {
        const plan = getBatchPlan(batch);
        const facts = aggregateFacts(batch.actualIngredients || []);
        const factTotal = facts.reduce((sum, item) => sum + Number(item.actualWeight || 0), 0);
        const batchDate = buildBatchDate(batch);

        reportBatches.push({
            id: batch.id,
            date: batchDate,
            rationName: batch.ration?.name || 'Без рациона',
            groupName: batch.group?.name || 'Без группы',
            planTotal: round1(plan.totalBatchWeight || 0),
            factTotal: round1(factTotal),
            violationsCount: batch.violations.length
        });
    }

    for (const violation of violations) {
        const batch = violation.batch;
        const batchDate = violation.detectedAt || buildBatchDate(batch);
        reportViolations.push({
            id: violation.id,
            batchId: violation.batchId,
            date: batchDate,
            batchLabel: violation.batchId ? `Замес #${violation.batchId}` : 'Без замеса',
            batch: violation.batchId ? `Замес #${violation.batchId}` : 'Без замеса',
            groupName: batch?.group?.name || 'Без группы',
            group: batch?.group?.name || 'Без группы',
            component: violation.componentName || '—',
            type: violation.title,
            violationType: violation.title,
            plan: round1(violation.planWeight || 0),
            fact: round1(violation.actualWeight || 0),
            deviation: round1(violation.deviation || 0),
            status: toUiViolationStatus(violation),
            code: violation.code,
            comment: violation.comment || null
        });
    }

    return {
        batches: reportBatches,
        violations: reportViolations
    };
}
