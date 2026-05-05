import { Router } from 'express';
import prisma from '../../database.js';
import { authenticate, requireAdmin, requireReadAccess, requireWriteAccess } from '../../middleware/auth.js';
import { collectReportData, DEFAULT_LIMIT, MAX_LIMIT, parseDateBoundary, parsePositiveInt } from '../reports/report-data.js';

const router = Router();

router.get('/', authenticate, requireReadAccess, async (req, res) => {
    try {
        const fromDate = parseDateBoundary(req.query.from, 'from');
        if (fromDate?.error) {
            return res.status(400).json({ error: fromDate.error });
        }

        const toDate = parseDateBoundary(req.query.to, 'to');
        if (toDate?.error) {
            return res.status(400).json({ error: toDate.error });
        }

        if (fromDate && toDate && fromDate > toDate) {
            return res.status(400).json({ error: 'Дата начала периода не может быть позже даты окончания' });
        }

        const scope = String(req.query.scope || 'all').trim().toLowerCase();
        if (!['all', 'open', 'resolved'].includes(scope)) {
            return res.status(400).json({ error: 'Параметр scope должен быть all, open или resolved' });
        }

        const limit = Math.min(parsePositiveInt(req.query.limit, DEFAULT_LIMIT), MAX_LIMIT);
        const data = await collectReportData({ fromDate, toDate, limit });
        let items = data.violations;

        if (scope === 'open') {
            items = items.filter((item) => ['OPEN', 'IN_PROGRESS'].includes(String(item.workflowStatus || '').toUpperCase()));
        } else if (scope === 'resolved') {
            items = items.filter((item) => ['CLOSED', 'RESOLVED'].includes(String(item.workflowStatus || '').toUpperCase()));
        }

        res.json({
            items,
            violations: items,
            period: data.period,
            summary: {
                ...data.summary,
                shownCount: items.length,
                scope
            }
        });
    } catch (error) {
        console.error('[Ошибка GET /violations]:', error);
        res.status(500).json({ error: 'Не удалось получить журнал нарушений' });
    }
});

router.patch('/:id', authenticate, requireWriteAccess, async (req, res) => {
    try {
        const violationId = parseInt(req.params.id, 10);
        if (!Number.isInteger(violationId) || violationId <= 0) {
            return res.status(400).json({ error: 'Некорректный ID нарушения' });
        }

        const data = {};
        if (req.body.status !== undefined) {
            const allowedStatuses = ['OPEN', 'IN_PROGRESS', 'CLOSED', 'RESOLVED'];
            if (!allowedStatuses.includes(req.body.status)) {
                return res.status(400).json({ error: `status должен быть одним из: ${allowedStatuses.join(', ')}` });
            }

            data.status = req.body.status;
            data.resolvedAt = req.body.status === 'CLOSED' || req.body.status === 'RESOLVED'
                ? new Date()
                : null;
        }

        if (req.body.comment !== undefined) {
            data.comment = String(req.body.comment || '').trim() || null;
        }

        if (!Object.keys(data).length) {
            return res.status(400).json({ error: 'Нет данных для обновления нарушения' });
        }

        const violation = await prisma.violation.update({
            where: { id: violationId },
            data
        });

        res.json({ status: 'ok', violation });
    } catch (error) {
        console.error('[Ошибка PATCH /violations/:id]:', error);
        if (error.code === 'P2025') {
            return res.status(404).json({ error: 'Нарушение не найдено' });
        }
        res.status(500).json({ error: 'Не удалось обновить нарушение' });
    }
});

router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const violationId = parseInt(req.params.id, 10);
        if (!Number.isInteger(violationId) || violationId <= 0) {
            return res.status(400).json({ error: 'Некорректный ID нарушения' });
        }

        const violation = await prisma.violation.findUnique({
            where: { id: violationId },
            select: { id: true, batchId: true }
        });

        if (!violation) {
            return res.status(404).json({ error: 'Нарушение не найдено' });
        }

        await prisma.$transaction(async (tx) => {
            await tx.violation.delete({
                where: { id: violationId }
            });

            if (violation.batchId) {
                const remainingCount = await tx.violation.count({
                    where: { batchId: violation.batchId }
                });

                if (remainingCount === 0) {
                    await tx.batch.update({
                        where: { id: violation.batchId },
                        data: { hasViolations: false }
                    });

                    await tx.batchIngredient.updateMany({
                        where: { batchId: violation.batchId },
                        data: { isViolation: false }
                    });
                }
            }
        });

        res.json({ status: 'ok', message: `Нарушение #${violationId} удалено` });
    } catch (error) {
        console.error('[Ошибка DELETE /violations/:id]:', error);
        res.status(500).json({ error: 'Не удалось удалить нарушение' });
    }
});

router.post('/admin/reset', authenticate, requireAdmin, async (req, res) => {
    try {
        const rawBatchId = req.body?.batchId;
        const batchId = rawBatchId === undefined || rawBatchId === null || rawBatchId === ''
            ? null
            : parseInt(rawBatchId, 10);

        if (rawBatchId !== undefined && rawBatchId !== null && rawBatchId !== '' && (!Number.isInteger(batchId) || batchId <= 0)) {
            return res.status(400).json({ error: 'Некорректный batchId' });
        }

        if (batchId) {
            const batch = await prisma.batch.findUnique({
                where: { id: batchId },
                select: { id: true }
            });
            if (!batch) {
                return res.status(404).json({ error: 'Замес не найден' });
            }

            const deleted = await prisma.$transaction(async (tx) => {
                const deletedResult = await tx.violation.deleteMany({
                    where: { batchId }
                });

                await tx.batch.update({
                    where: { id: batchId },
                    data: { hasViolations: false }
                });

                await tx.batchIngredient.updateMany({
                    where: { batchId },
                    data: { isViolation: false }
                });

                return deletedResult.count;
            });

            return res.json({
                status: 'ok',
                scope: 'batch',
                batchId,
                deleted
            });
        }

        const result = await prisma.$transaction(async (tx) => {
            const deletedViolations = await tx.violation.deleteMany({});
            const updatedBatches = await tx.batch.updateMany({
                data: { hasViolations: false }
            });
            const updatedIngredients = await tx.batchIngredient.updateMany({
                data: { isViolation: false }
            });

            return {
                deletedViolations: deletedViolations.count,
                updatedBatches: updatedBatches.count,
                updatedIngredients: updatedIngredients.count
            };
        });

        res.json({
            status: 'ok',
            scope: 'all',
            ...result
        });
    } catch (error) {
        console.error('[Ошибка POST /violations/admin/reset]:', error);
        res.status(500).json({ error: 'Не удалось выполнить сброс нарушений' });
    }
});

export default router;
