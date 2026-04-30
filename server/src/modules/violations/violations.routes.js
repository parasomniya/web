import { Router } from 'express';
import { authenticate, requireReadAccess } from '../../middleware/auth.js';
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

        const limit = Math.min(parsePositiveInt(req.query.limit, DEFAULT_LIMIT), MAX_LIMIT);
        const data = await collectReportData({ fromDate, toDate, limit });

        res.json(data.violations);
    } catch (error) {
        console.error('[Ошибка GET /violations]:', error);
        res.status(500).json({ error: 'Не удалось получить журнал нарушений' });
    }
});

export default router;
