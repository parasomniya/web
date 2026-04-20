import { Router } from 'express';
import prisma from '../../database.js';
import { requireReadAccess, requireWriteAccess } from '../../middleware/auth.js';

const router = Router();

router.get('/', requireReadAccess, async (req, res) => {
    try {
        const groups = await prisma.livestockGroup.findMany({
            include: {
                ration: {
                    select: {
                        id: true,
                        name: true,
                        isActive: true
                    }
                }
            },
            orderBy: { name: 'asc' }
        });

        res.json(groups.map(group => ({
            id: group.id,
            name: group.name,
            headcount: group.headcount,
            rationId: group.rationId,
            rationName: group.ration?.name || null,
            ration: group.ration,
            lat: group.lat,
            lon: group.lon,
            radius: group.radius
        })));
    } catch (error) {
        console.error('[Ошибка GET /groups]:', error);
        res.status(500).json({ error: 'Не удалось получить список групп' });
    }
});

router.post('/', requireWriteAccess, async (req, res) => {
    try {
        const name = String(req.body.name || '').trim();
        const headcount = parseInt(req.body.headcount, 10);
        const rationId = req.body.rationId ? parseInt(req.body.rationId, 10) : null;
        const lat = req.body.lat !== undefined && req.body.lat !== '' ? Number(req.body.lat) : null;
        const lon = req.body.lon !== undefined && req.body.lon !== '' ? Number(req.body.lon) : null;
        const radius = req.body.radius !== undefined && req.body.radius !== '' ? Number(req.body.radius) : 30;

        if (!name) return res.status(400).json({ error: 'Название группы обязательно' });
        if (!Number.isInteger(headcount) || headcount <= 0) return res.status(400).json({ error: 'Поголовье должно быть положительным числом' });
        if (rationId !== null) {
            const ration = await prisma.ration.findUnique({ where: { id: rationId } });
            if (!ration) return res.status(404).json({ error: 'Рацион не найден' });
        }
        if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) return res.status(400).json({ error: 'Некорректная широта' });
        if (lon !== null && (!Number.isFinite(lon) || lon < -180 || lon > 180)) return res.status(400).json({ error: 'Некорректная долгота' });
        if (!Number.isFinite(radius) || radius <= 0) return res.status(400).json({ error: 'Радиус должен быть положительным числом' });

        const group = await prisma.livestockGroup.create({
            data: { name, headcount, rationId, lat, lon, radius }
        });

        res.status(201).json(group);
    } catch (error) {
        console.error('[Ошибка POST /groups]:', error);
        res.status(500).json({ error: 'Не удалось создать группу' });
    }
});

export default router;
