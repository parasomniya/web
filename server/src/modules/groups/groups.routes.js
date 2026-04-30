import { Router } from 'express';
import prisma from '../../database.js';
import { requireReadAccess, requireWriteAccess } from '../../middleware/auth.js';

const router = Router();

function parseGroupId(value) {
    const id = parseInt(value, 10);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function mapGroupResponse(group) {
    return {
        id: group.id,
        name: group.name,
        headcount: group.headcount,
        rationId: group.rationId,
        rationName: group.ration?.name || null,
        ration: group.ration || null,
        storageZoneId: group.storageZoneId ?? null,
        storageZone: group.storageZone ? {
            id: group.storageZone.id,
            name: group.storageZone.name,
            shapeType: group.storageZone.shapeType,
            radius: group.storageZone.radius,
            sideMeters: group.storageZone.sideMeters,
            lat: group.storageZone.lat,
            lon: group.storageZone.lon,
            active: group.storageZone.active
        } : null,
        lat: group.lat,
        lon: group.lon,
        radius: group.radius
    };
}

async function findStorageZoneById(storageZoneId) {
    return prisma.storageZone.findUnique({
        where: { id: storageZoneId },
        select: {
            id: true,
            name: true,
            lat: true,
            lon: true,
            radius: true,
            shapeType: true,
            sideMeters: true,
            active: true
        }
    });
}

async function buildGroupData(payload, options = {}) {
    const {
        requireName = false,
        allowPartial = false,
        currentGroupId = null
    } = options;

    const data = {};

    if (payload.name !== undefined || requireName) {
        const name = String(payload.name || '').trim();
        if (!name) {
            return { error: { status: 400, message: 'Название группы обязательно' } };
        }

        const duplicateGroup = await prisma.livestockGroup.findFirst({
            where: {
                name,
                ...(currentGroupId ? { NOT: { id: currentGroupId } } : {})
            },
            select: { id: true }
        });

        if (duplicateGroup) {
            return { error: { status: 409, message: 'Группа с таким названием уже существует' } };
        }

        data.name = name;
    }

    if (payload.headcount !== undefined || !allowPartial) {
        const headcount = parseInt(payload.headcount, 10);
        if (!Number.isInteger(headcount) || headcount <= 0) {
            return { error: { status: 400, message: 'Поголовье должно быть положительным целым числом' } };
        }

        data.headcount = headcount;
    }

    if (payload.rationId !== undefined || !allowPartial) {
        if (payload.rationId === null || payload.rationId === '') {
            data.rationId = null;
        } else {
            const rationId = parseInt(payload.rationId, 10);
            if (!Number.isInteger(rationId) || rationId <= 0) {
                return { error: { status: 400, message: 'Некорректный rationId' } };
            }

            const ration = await prisma.ration.findUnique({
                where: { id: rationId },
                select: { id: true }
            });

            if (!ration) {
                return { error: { status: 404, message: 'Рацион не найден' } };
            }

            data.rationId = rationId;
        }
    }

    const hasStorageZoneId = payload.storageZoneId !== undefined;
    const hasLegacyCoordinates = payload.lat !== undefined || payload.lon !== undefined || payload.radius !== undefined;

    if (hasStorageZoneId) {
        if (payload.storageZoneId === null || payload.storageZoneId === '') {
            data.storageZoneId = null;
            data.lat = null;
            data.lon = null;
            data.radius = 30;
        } else {
            const storageZoneId = parseInt(payload.storageZoneId, 10);
            if (!Number.isInteger(storageZoneId) || storageZoneId <= 0) {
                return { error: { status: 400, message: 'Некорректный storageZoneId' } };
            }

            const storageZone = await findStorageZoneById(storageZoneId);
            if (!storageZone) {
                return { error: { status: 404, message: 'Зона хранения не найдена' } };
            }

            data.storageZoneId = storageZoneId;
            data.lat = storageZone.lat;
            data.lon = storageZone.lon;
            data.radius = Number.isFinite(Number(storageZone.radius)) && Number(storageZone.radius) > 0
                ? Number(storageZone.radius)
                : 30;
        }
    } else if (hasLegacyCoordinates) {
        const lat = payload.lat !== undefined && payload.lat !== '' ? Number(payload.lat) : null;
        const lon = payload.lon !== undefined && payload.lon !== '' ? Number(payload.lon) : null;
        const radius = payload.radius !== undefined && payload.radius !== '' ? Number(payload.radius) : 30;

        if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) {
            return { error: { status: 400, message: 'Некорректная широта' } };
        }

        if (lon !== null && (!Number.isFinite(lon) || lon < -180 || lon > 180)) {
            return { error: { status: 400, message: 'Некорректная долгота' } };
        }

        if (!Number.isFinite(radius) || radius <= 0) {
            return { error: { status: 400, message: 'Радиус должен быть положительным числом' } };
        }

        data.storageZoneId = null;
        data.lat = lat;
        data.lon = lon;
        data.radius = radius;
    } else if (!allowPartial) {
        return { error: { status: 400, message: 'Выберите зону хранения' } };
    }

    return { data };
}

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
                },
                storageZone: {
                    select: {
                        id: true,
                        name: true,
                        shapeType: true,
                        radius: true,
                        sideMeters: true,
                        lat: true,
                        lon: true,
                        active: true
                    }
                }
            },
            orderBy: { name: 'asc' }
        });

        res.json(groups.map(mapGroupResponse));
    } catch (error) {
        console.error('[Ошибка GET /groups]:', error);
        res.status(500).json({ error: 'Не удалось получить список групп' });
    }
});

router.post('/', requireWriteAccess, async (req, res) => {
    try {
        const result = await buildGroupData(req.body, {
            requireName: true,
            allowPartial: false
        });

        if (result.error) {
            return res.status(result.error.status).json({ error: result.error.message });
        }

        const group = await prisma.livestockGroup.create({
            data: result.data,
            include: {
                ration: {
                    select: {
                        id: true,
                        name: true,
                        isActive: true
                    }
                },
                storageZone: {
                    select: {
                        id: true,
                        name: true,
                        shapeType: true,
                        radius: true,
                        sideMeters: true,
                        lat: true,
                        lon: true,
                        active: true
                    }
                }
            }
        });

        res.status(201).json(mapGroupResponse(group));
    } catch (error) {
        console.error('[Ошибка POST /groups]:', error);
        res.status(500).json({ error: 'Не удалось создать группу' });
    }
});

router.put('/:id', requireWriteAccess, async (req, res) => {
    try {
        const groupId = parseGroupId(req.params.id);
        if (!groupId) {
            return res.status(400).json({ error: 'Некорректный ID группы' });
        }

        const existingGroup = await prisma.livestockGroup.findUnique({
            where: { id: groupId },
            select: { id: true }
        });

        if (!existingGroup) {
            return res.status(404).json({ error: 'Группа не найдена' });
        }

        const result = await buildGroupData(req.body, {
            allowPartial: true,
            currentGroupId: groupId
        });

        if (result.error) {
            return res.status(result.error.status).json({ error: result.error.message });
        }

        if (!Object.keys(result.data).length) {
            return res.status(400).json({ error: 'Нет данных для обновления группы' });
        }

        const group = await prisma.livestockGroup.update({
            where: { id: groupId },
            data: result.data,
            include: {
                ration: {
                    select: {
                        id: true,
                        name: true,
                        isActive: true
                    }
                },
                storageZone: {
                    select: {
                        id: true,
                        name: true,
                        shapeType: true,
                        radius: true,
                        sideMeters: true,
                        lat: true,
                        lon: true,
                        active: true
                    }
                }
            }
        });

        res.json({
            status: 'ok',
            message: 'Группа обновлена',
            group: mapGroupResponse(group)
        });
    } catch (error) {
        console.error('[Ошибка PUT /groups/:id]:', error);
        if (error.code === 'P2025') {
            return res.status(404).json({ error: 'Группа не найдена' });
        }
        res.status(500).json({ error: 'Не удалось обновить группу' });
    }
});

router.delete('/:id', requireWriteAccess, async (req, res) => {
    try {
        const groupId = parseGroupId(req.params.id);
        if (!groupId) {
            return res.status(400).json({ error: 'Некорректный ID группы' });
        }

        const group = await prisma.livestockGroup.findUnique({
            where: { id: groupId },
            select: { id: true, name: true }
        });

        if (!group) {
            return res.status(404).json({ error: 'Группа не найдена' });
        }

        const linkedBatchCount = await prisma.batch.count({
            where: { groupId }
        });

        await prisma.$transaction(async (tx) => {
            if (linkedBatchCount > 0) {
                await tx.batch.updateMany({
                    where: { groupId },
                    data: { groupId: null }
                });
            }

            await tx.livestockGroup.delete({
                where: { id: groupId }
            });
        });

        res.json({
            status: 'ok',
            message: linkedBatchCount > 0
                ? `Группа удалена. Из ${linkedBatchCount} замесов снята привязка к группе.`
                : 'Группа удалена'
        });
    } catch (error) {
        console.error('[Ошибка DELETE /groups/:id]:', error);
        if (error.code === 'P2025') {
            return res.status(404).json({ error: 'Группа не найдена' });
        }
        res.status(500).json({ error: 'Не удалось удалить группу' });
    }
});

export default router;
