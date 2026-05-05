import { calculatePlan, checkViolations, normalizeIngredientName } from '../../../../module-2/rationManager.js';
import { syncBatchViolationLog } from '../violations/violation-service.js';

function round1(value) {
    return Math.round(Number(value || 0) * 10) / 10;
}

export function toDisplayIngredientName(value) {
    const raw = String(value || '').trim();
    const normalized = normalizeIngredientName(raw);

    if (!raw || normalized === 'unknown') {
        return 'Неизвестный';
    }

    return raw;
}

export function aggregateFacts(ingredients) {
    const facts = new Map();

    for (const ingredient of ingredients) {
        const key = normalizeIngredientName(ingredient.ingredientName);
        const current = facts.get(key) || { name: toDisplayIngredientName(ingredient.ingredientName), actualWeight: 0 };
        current.actualWeight += Number(ingredient.actualWeight || 0);
        facts.set(key, current);
    }

    return Array.from(facts.values());
}

export function getBatchPlan(batch) {
    if (!batch?.ration?.ingredients || !batch?.group?.headcount) {
        return { totalBatchWeight: 0, totalDryMatterWeight: 0, ingredients: [] };
    }

    return calculatePlan(batch.ration.ingredients, batch.group.headcount);
}

export function buildIngredientSummary(batch, threshold = 10) {
    const plan = getBatchPlan(batch);
    const facts = aggregateFacts(batch?.actualIngredients || []);
    const hasPlanContext = plan.ingredients.length > 0;
    const factMap = new Map(facts.map((item) => [normalizeIngredientName(item.name), item.actualWeight]));
    const planMap = new Map(plan.ingredients.map((item) => [normalizeIngredientName(item.name), item.targetWeight]));
    const nameMap = new Map([
        ...facts.map((item) => [normalizeIngredientName(item.name), item.name]),
        ...plan.ingredients.map((item) => [normalizeIngredientName(item.name), item.name])
    ]);
    const persistedViolationMap = new Map((batch?.actualIngredients || []).map((item) => [normalizeIngredientName(item.ingredientName), item.isViolation]));
    const names = new Set([...planMap.keys(), ...factMap.keys()]);

    return Array.from(names).map((key) => {
        const name = toDisplayIngredientName(nameMap.get(key) || key || 'Unknown');
        const planWeight = planMap.get(key) || 0;
        const factWeight = factMap.get(key) || 0;
        const deviationPercent = planWeight > 0
            ? Math.round(((factWeight - planWeight) / planWeight) * 1000) / 10
            : (factWeight > 0 ? 100 : 0);
        const isViolation = planWeight > 0
            ? Math.abs(deviationPercent) > threshold
            : (hasPlanContext
                ? factWeight > 0
                : Boolean(factWeight > 0 || persistedViolationMap.get(key) || key === 'unknown'));

        return {
            name,
            plan: round1(planWeight),
            fact: round1(factWeight),
            deviation_percent: deviationPercent,
            is_violation: isViolation
        };
    });
}

export function buildUnloadProgress(batch, currentWeight, machineState = {}) {
    if (!batch) return null;

    const plan = getBatchPlan(batch);
    const factLoaded = aggregateFacts(batch.actualIngredients || []).reduce((sum, item) => sum + item.actualWeight, 0);
    const peakWeight = Math.max(Number(machineState.peakWeight || 0), Number(batch.startWeight || 0) + factLoaded);
    const targetWeight = plan.totalBatchWeight > 0 ? plan.totalBatchWeight : Math.max(0, peakWeight - Number(batch.startWeight || 0));
    const unloadedFact = Math.max(0, peakWeight - Number(currentWeight || 0));

    return {
        target_weight: round1(targetWeight),
        unloaded_fact: round1(unloadedFact)
    };
}

export async function recalculateBatchViolations(prisma, batchId, threshold = 10) {
    const batch = await prisma.batch.findUnique({
        where: { id: Number(batchId) },
        include: {
            group: true,
            ration: { include: { ingredients: true } },
            actualIngredients: true
        }
    });

    if (!batch) {
        return { status: 'missing', hasViolations: false };
    }

    if (!batch.ration || !batch.group || !batch.group.headcount) {
        const facts = aggregateFacts(batch.actualIngredients);
        const syntheticViolations = facts
            .filter((item) => Number(item.actualWeight || 0) > 0)
            .map((item) => ({
                ingredient: toDisplayIngredientName(item.name || 'Unknown'),
                plan: 0,
                fact: Number(item.actualWeight || 0),
                deviationPercent: 100,
                message: 'Загружен компонент вне плана (рацион/группа не назначены)'
            }));
        const violationNames = new Set(syntheticViolations.map((item) => normalizeIngredientName(item.ingredient)));

        for (const ingredient of batch.actualIngredients) {
            await prisma.batchIngredient.update({
                where: { id: ingredient.id },
                data: {
                    plannedWeight: 0,
                    isViolation: violationNames.has(normalizeIngredientName(ingredient.ingredientName))
                }
            });
        }

        await syncBatchViolationLog(prisma, batch, { matches: [], violations: syntheticViolations });

        await prisma.batch.update({
            where: { id: batch.id },
            data: { hasViolations: syntheticViolations.length > 0 }
        });

        return {
            status: 'skipped',
            reason: 'Batch has no ration/group assignment',
            hasViolations: syntheticViolations.length > 0,
            violations: syntheticViolations
        };
    }

    const plan = getBatchPlan(batch);
    const facts = aggregateFacts(batch.actualIngredients);
    const check = checkViolations(plan.ingredients, facts, threshold);
    const violationNames = new Set(check.violations.map((item) => normalizeIngredientName(item.ingredient)));
    const planByName = new Map(plan.ingredients.map((item) => [normalizeIngredientName(item.name), item.targetWeight]));

    for (const ingredient of batch.actualIngredients) {
        await prisma.batchIngredient.update({
            where: { id: ingredient.id },
            data: {
                plannedWeight: planByName.get(normalizeIngredientName(ingredient.ingredientName)) ?? 0,
                isViolation: violationNames.has(normalizeIngredientName(ingredient.ingredientName))
            }
        });
    }

    await prisma.batch.update({
        where: { id: batch.id },
        data: { hasViolations: check.violations.length > 0 }
    });

    await syncBatchViolationLog(prisma, batch, check);

    return {
        status: 'ok',
        hasViolations: check.violations.length > 0,
        matches: check.matches,
        violations: check.violations
    };
}
