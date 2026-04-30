import { Router } from 'express';
import prisma from "../../database.js"; // Проверь путь до твоего файла Prisma
import bcrypt from "bcrypt"; // Используем уже установленный пакет
import { authenticate, requireWriteAccess } from "../../middleware/auth.js"; // Проверь путь до middleware

const router = Router();
const VALID_ROLES = ['ADMIN', 'DIRECTOR', 'GUEST'];

function parseUserId(value) {
    const id = parseInt(value, 10);
    return Number.isInteger(id) ? id : null;
}

function isValidEmail(email) {
    if (!email) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ============================================================================
// 1. GET / - Получить список всех пользователей (для таблицы в админке)
// ============================================================================
router.get('/', authenticate, async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            // Выбираем только безопасные поля, без паролей
            select: {
                id: true,
                username: true,
                email: true,
                role: true,
                createdAt: true
            },
            orderBy: { createdAt: 'desc' }
        });
        
        res.json(users);
    } catch (error) {
        console.error('[Ошибка GET /users]:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// 2. POST / - Создание нового пользователя из админки
// ============================================================================
router.post('/', authenticate, requireWriteAccess, async (req, res) => {
    try {
        const { username, email, password, role } = req.body;
        const normalizedUsername = String(username || '').trim();
        const normalizedEmail = email ? String(email).trim() : null;
        const normalizedRole = role || 'GUEST';

        if (!normalizedUsername) {
            return res.status(400).json({ error: 'Логин обязателен' });
        }

        if (!isValidEmail(normalizedEmail)) {
            return res.status(400).json({ error: 'Некорректный email' });
        }

        if (!VALID_ROLES.includes(normalizedRole)) {
            return res.status(400).json({ error: 'Недопустимая роль. Доступны: ADMIN, DIRECTOR, GUEST' });
        }

        if (!password || password.length < 6) {
            return res.status(400).json({ error: 'Пароль должен быть минимум 6 символов' });
        }

        // Хешируем пароль перед сохранением в базу
        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = await prisma.user.create({
            data: {
                username: normalizedUsername,
                email: normalizedEmail,
                password: hashedPassword,
                role: normalizedRole
            },
            select: { id: true, username: true, email: true, role: true }
        });

        res.status(201).json(newUser);
    } catch (error) {
        console.error('[Ошибка POST /users]:', error);
        // Prisma вернет ошибку уникальности (P2002), если email или username уже есть
        if (error.code === 'P2002') {
            return res.status(400).json({ error: 'Пользователь с таким email или именем уже существует' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// 3. PATCH /:id - Изменить логин и email пользователя
// ============================================================================
router.patch('/:id', authenticate, requireWriteAccess, async (req, res) => {
    try {
        const userId = parseUserId(req.params.id);
        if (!userId) {
            return res.status(400).json({ error: 'Некорректный ID пользователя' });
        }

        const existingUser = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                username: true,
                email: true,
                role: true,
                createdAt: true,
            }
        });

        if (!existingUser) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        const hasUsername = Object.prototype.hasOwnProperty.call(req.body || {}, 'username');
        const hasEmail = Object.prototype.hasOwnProperty.call(req.body || {}, 'email');

        if (!hasUsername && !hasEmail) {
            return res.status(400).json({ error: 'Нет полей для обновления' });
        }

        const data = {};

        if (hasUsername) {
            const normalizedUsername = String(req.body.username || '').trim();
            if (!normalizedUsername) {
                return res.status(400).json({ error: 'Логин обязателен' });
            }
            data.username = normalizedUsername;
        }

        if (hasEmail) {
            const rawEmail = req.body.email;
            const normalizedEmail = rawEmail == null ? null : String(rawEmail).trim();

            if (!isValidEmail(normalizedEmail)) {
                return res.status(400).json({ error: 'Некорректный email' });
            }

            data.email = normalizedEmail || null;
        }

        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data,
            select: {
                id: true,
                username: true,
                email: true,
                role: true,
                createdAt: true,
            }
        });

        res.json({
            status: 'ok',
            message: 'Пользователь обновлен',
            user: updatedUser,
        });
    } catch (error) {
        console.error('[Ошибка PATCH /users/:id]:', error);

        if (error.code === 'P2002') {
            return res.status(409).json({ error: 'Пользователь с таким логином или email уже существует' });
        }

        res.status(500).json({ error: 'Ошибка сервера при обновлении пользователя' });
    }
});

// ============================================================================
// 4. PATCH /:id/role - Изменить роль пользователя
// ============================================================================
router.patch('/:id/role', authenticate, requireWriteAccess, async (req, res) => {
    try {
        const userId = parseUserId(req.params.id);
        const { role } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'Некорректный ID пользователя' });
        }
        
        // Проверяем, что прислали правильную роль (согласно enum в schema.prisma)
        if (!VALID_ROLES.includes(role)) {
            return res.status(400).json({ error: 'Недопустимая роль. Доступны: ADMIN, DIRECTOR, GUEST' });
        }

        const existingUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, username: true, role: true }
        });

        if (!existingUser) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        if (existingUser.role === 'ADMIN' && role !== 'ADMIN') {
            const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
            if (adminCount <= 1) {
                return res.status(409).json({ error: 'Нельзя снять роль у последнего администратора' });
            }
        }

        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: { role },
            select: { id: true, username: true, role: true } 
        });

        res.json({ status: 'ok', message: 'Роль успешно обновлена', user: updatedUser });
    } catch (error) {
        console.error('[Ошибка PATCH /users/:id/role]:', error);
        if (error.code === 'P2025') {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        res.status(500).json({ error: 'Ошибка сервера при обновлении пользователя' });
    }
});

// ============================================================================
// 5. DELETE /:id - Удаление пользователя
// ============================================================================
router.delete('/:id', authenticate, requireWriteAccess, async (req, res) => {
    try {
        const userId = parseUserId(req.params.id);
        if (!userId) {
            return res.status(400).json({ error: 'Некорректный ID пользователя' });
        }

        if (req.user?.id === userId) {
            return res.status(400).json({ error: 'Нельзя удалить текущего пользователя из активной сессии' });
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, username: true, role: true }
        });

        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        if (user.role === 'ADMIN') {
            const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
            if (adminCount <= 1) {
                return res.status(409).json({ error: 'Нельзя удалить последнего администратора' });
            }
        }

        await prisma.user.delete({
            where: { id: userId }
        });
        res.json({ status: 'ok', message: 'Пользователь удален' });
    } catch (error) {
        console.error('[Ошибка DELETE /users/:id]:', error);
        res.status(500).json({ error: 'Ошибка при удалении пользователя' });
    }
});

export default router;
