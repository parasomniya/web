import { calculatePlan, checkViolations } from '../../../../module-2/rationManager.js';

export function aggregateFacts(ingredients) {
    const facts = new Map();

    for (const ingredient of ingredients) {
        const current = facts.get(ingredient.ingredientName) || 0;
        facts.set(ingredient.ingredientName, current + ingredient.actualWeight);
    }

    return Array.from(facts.entries()).map(([name, actualWeight]) => ({ name, actualWeight }));
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
    const factMap = new Map(facts.map((item) => [item.name, item.actualWeight]));
    const planMap = new Map(plan.ingredients.map((item) => [item.name, item.targetWeight]));
    const persistedViolationMap = new Map((batch?.actualIngredients || []).map((item) => [item.ingredientName, item.isViolation]));
    const names = new Set([...planMap.keys(), ...factMap.keys()]);

    return Array.from(names).map((name) => {
        const planWeight = planMap.get(name) || 0;
        const factWeight = factMap.get(name) || 0;
        const deviationPercent = planWeight > 0
            ? Math.round(((factWeight - planWeight) / planWeight) * 1000) / 10
            : (factWeight > 0 ? 100 : 0);
        const isViolation = planWeight > 0
            ? Math.abs(deviationPercent) > threshold
            : Boolean(persistedViolationMap.get(name) || name === 'Unknown');

        return {
            name,
            plan: planWeight,
            fact: factWeight,
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
        target_weight: Math.round(targetWeight * 10) / 10,
        unloaded_fact: Math.round(unloadedFact * 10) / 10
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
        await prisma.$transaction([
            prisma.batchIngredient.updateMany({
                where: { batchId: batch.id },
                data: { plannedWeight: null, isViolation: false }
            }),
            prisma.batch.update({
                where: { id: batch.id },
                data: { hasViolations: false }
            })
        ]);

        return { status: 'skipped', reason: 'Batch has no ration/group assignment', hasViolations: false };
    }

    const plan = getBatchPlan(batch);
    const facts = aggregateFacts(batch.actualIngredients);
    const check = checkViolations(plan.ingredients, facts, threshold);
    const violationNames = new Set(check.violations.map((item) => item.ingredient));
    const planByName = new Map(plan.ingredients.map((item) => [item.name, item.targetWeight]));

    await prisma.$transaction([
        ...batch.actualIngredients.map((ingredient) => prisma.batchIngredient.update({
            where: { id: ingredient.id },
            data: {
                plannedWeight: planByName.get(ingredient.ingredientName) ?? 0,
                isViolation: violationNames.has(ingredient.ingredientName)
            }
        })),
        prisma.batch.update({
            where: { id: batch.id },
            data: { hasViolations: check.violations.length > 0 }
        })
    ]);

    return {
        status: 'ok',
        hasViolations: check.violations.length > 0,
        matches: check.matches,
        violations: check.violations
    };
}
