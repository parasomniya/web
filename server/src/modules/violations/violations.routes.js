import { Router } from 'express';
import prisma from '../../database.js';
import { authenticate, requireReadAccess, requireWriteAccess } from '../../middleware/auth.js';
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

export default router;
