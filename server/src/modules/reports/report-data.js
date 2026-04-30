import prisma from '../../database.js';
import { aggregateFacts, getBatchPlan } from '../batches/batch-violations.js';
import { checkViolations } from '../../../../module-2/rationManager.js';

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

function getViolationType(violation) {
    const plan = Number(violation?.plan || 0);
    const fact = Number(violation?.fact || 0);
    const deviation = fact - plan;

    if (plan > 0 && fact === 0) {
        return 'Пропуск компонента';
    }

    if (plan === 0 && fact > 0) {
        return 'Лишний компонент';
    }

    if (deviation > 0) {
        return 'Перевложение';
    }

    if (deviation < 0) {
        return 'Недовложение';
    }

    return 'Нарушение';
}

function getViolationStatus(violation) {
    const plan = Number(violation?.plan || 0);
    const fact = Number(violation?.fact || 0);
    const deviation = fact - plan;
    const deviationPercent = plan > 0 ? Math.abs((deviation / plan) * 100) : (fact > 0 ? 100 : 0);

    if ((plan > 0 && fact === 0) || (plan === 0 && fact > 0) || deviationPercent >= 20) {
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
            }
        },
        orderBy: { startTime: 'desc' },
        take: Math.min(limit, MAX_LIMIT)
    });

    const reportBatches = [];
    const reportViolations = [];

    for (const batch of batches) {
        const plan = getBatchPlan(batch);
        const facts = aggregateFacts(batch.actualIngredients || []);
        const factTotal = facts.reduce((sum, item) => sum + Number(item.actualWeight || 0), 0);
        const violationsCheck = checkViolations(plan.ingredients || [], facts, VIOLATION_THRESHOLD);
        const batchDate = buildBatchDate(batch);

        reportBatches.push({
            id: batch.id,
            date: batchDate,
            rationName: batch.ration?.name || 'Без рациона',
            groupName: batch.group?.name || 'Без группы',
            planTotal: round1(plan.totalBatchWeight || 0),
            factTotal: round1(factTotal),
            violationsCount: violationsCheck.violations.length
        });

        for (const violation of violationsCheck.violations) {
            const planWeight = round1(violation.plan || 0);
            const factWeight = round1(violation.fact || 0);
            const deviation = round1(factWeight - planWeight);
            const type = getViolationType({
                plan: planWeight,
                fact: factWeight
            });

            reportViolations.push({
                batchId: batch.id,
                date: batchDate,
                batchLabel: `Замес #${batch.id}`,
                batch: `Замес #${batch.id}`,
                groupName: batch.group?.name || 'Без группы',
                group: batch.group?.name || 'Без группы',
                component: violation.ingredient || '—',
                type,
                violationType: type,
                plan: planWeight,
                fact: factWeight,
                deviation,
                status: getViolationStatus({
                    plan: planWeight,
                    fact: factWeight
                })
            });
        }
    }

    return {
        batches: reportBatches,
        violations: reportViolations
    };
}
