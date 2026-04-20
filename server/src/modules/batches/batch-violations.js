import { calculatePlan, checkViolations } from '../../../../module-2/rationManager.js';

function aggregateFacts(ingredients) {
    const facts = new Map();

    for (const ingredient of ingredients) {
        const current = facts.get(ingredient.ingredientName) || 0;
        facts.set(ingredient.ingredientName, current + ingredient.actualWeight);
    }

    return Array.from(facts.entries()).map(([name, actualWeight]) => ({ name, actualWeight }));
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
        await prisma.batch.update({
            where: { id: batch.id },
            data: { hasViolations: false }
        });

        return { status: 'skipped', reason: 'Batch has no ration/group assignment', hasViolations: false };
    }

    const plan = calculatePlan(batch.ration.ingredients, batch.group.headcount);
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
