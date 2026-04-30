import { Router } from 'express';
import prisma from '../../database.js';
import { authenticate, requireAdmin } from '../../middleware/auth.js';
import { getZoneByCoordinates, isFreshTimestamp, resolveEffectiveCoordinates } from './telemetry-helpers.js';

const router = Router();

function hasValidCoordinates(lat, lon) {
    return Number.isFinite(Number(lat))
        && Number.isFinite(Number(lon))
        && Number(lat) >= -90
        && Number(lat) <= 90
        && Number(lon) >= -180
        && Number(lon) <= 180;
}

function asBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true' || normalized === '1') return true;
        if (normalized === 'false' || normalized === '0') return false;
    }
    return Boolean(value);
}

function buildUpdatedAt(hostRow, rtkRow) {
    const timestamps = [hostRow?.timestamp, rtkRow?.timestamp]
        .map((value) => value ? new Date(value).getTime() : NaN)
        .filter((value) => !Number.isNaN(value));

    if (!timestamps.length) {
        return null;
    }

    return new Date(Math.max(...timestamps)).toISOString();
}

router.get('/current', authenticate, requireAdmin, async (req, res) => {
    try {
        const [latestHost, latestRtk, activeZones] = await Promise.all([
            prisma.telemetry.findFirst({
                orderBy: { timestamp: 'desc' },
                select: {
                    id: true,
                    deviceId: true,
                    timestamp: true,
                    lat: true,
                    lon: true,
                    gpsValid: true,
                    gpsQuality: true
                }
            }),
            prisma.rtkTelemetry.findFirst({
                orderBy: { timestamp: 'desc' },
                select: {
                    id: true,
                    deviceId: true,
                    timestamp: true,
                    lat: true,
                    lon: true
                }
            }),
            prisma.storageZone.findMany({
                where: { active: true }
            })
        ]);

        const items = [];
        const updatedAt = buildUpdatedAt(latestHost, latestRtk);

        if (!latestHost || !isFreshTimestamp(latestHost.timestamp)) {
            items.push({
                code: 'no_fresh_packets',
                title: 'Нет свежих пакетов',
                message: latestHost?.timestamp
                    ? `Последний host пакет устарел: ${new Date(latestHost.timestamp).toLocaleString('ru-RU')}.`
                    : 'Телеметрия от host ещё не поступала.',
                severity: 'warning'
            });

            return res.json({
                items,
                source: 'backend',
                updatedAt
            });
        }

        const gpsQuality = Number(latestHost.gpsQuality);
        const hasGpsCoordinates = hasValidCoordinates(latestHost.lat, latestHost.lon);
        const hasGpsFlag = latestHost.gpsValid == null ? true : asBoolean(latestHost.gpsValid);
        const hasGps = hasGpsCoordinates && hasGpsFlag && (!Number.isFinite(gpsQuality) || gpsQuality > 0);

        if (!hasGps) {
            items.push({
                code: 'no_gps',
                title: 'Нет GPS',
                message: 'Координаты не определены или GPS fix отсутствует.',
                severity: 'danger'
            });
        }

        if (!latestRtk || !isFreshTimestamp(latestRtk.timestamp)) {
            items.push({
                code: 'no_rtk',
                title: 'Нет RTK',
                message: latestRtk?.timestamp
                    ? `Последний RTK пакет устарел: ${new Date(latestRtk.timestamp).toLocaleString('ru-RU')}.`
                    : 'RTK телеметрия ещё не поступала.',
                severity: 'warning'
            });
        }

        if (activeZones.length > 0 && hasGpsCoordinates) {
            const effectivePosition = await resolveEffectiveCoordinates(prisma, latestHost, {
                deviceId: latestHost.deviceId,
                referenceTime: latestHost.timestamp
            });
            const currentZone = getZoneByCoordinates(effectivePosition.lat, effectivePosition.lon, activeZones);
            if (!currentZone) {
                items.push({
                    code: 'unknown_zone',
                    title: 'Неизвестная зона',
                    message: 'Текущие координаты не попали ни в одну активную зону.',
                    severity: 'warning'
                });
            }
        }

        res.json({
            items,
            source: 'backend',
            updatedAt
        });
    } catch (error) {
        console.error('[Ошибка GET /telemetry/warnings/current]:', error);
        res.status(500).json({ error: 'Не удалось получить технические предупреждения' });
    }
});

export default router;
