import { Router } from 'express';
import prisma from "../../database.js"; // Проверь путь до твоего файла Prisma
import bcrypt from "bcrypt"; // Используем уже установленный пакет
import { authenticate, requireWriteAccess } from "../../middleware/auth.js"; // Проверь путь до middleware

const router = Router();

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

        if (!password || password.length < 6) {
            return res.status(400).json({ error: 'Пароль должен быть минимум 6 символов' });
        }

        // Хешируем пароль перед сохранением в базу
        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = await prisma.user.create({
            data: {
                username,
                email,
                password: hashedPassword,
                role: role || 'GUEST' // Если роль не передали, ставим GUEST
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
// 3. PATCH /:id/role - Изменить роль пользователя
// ============================================================================
router.patch('/:id/role', authenticate, requireWriteAccess, async (req, res) => {
    try {
        const { role } = req.body;
        
        // Проверяем, что прислали правильную роль (согласно enum в schema.prisma)
        const validRoles = ['ADMIN', 'DIRECTOR', 'GUEST'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({ error: 'Недопустимая роль. Доступны: ADMIN, DIRECTOR, GUEST' });
        }

        const updatedUser = await prisma.user.update({
            where: { id: parseInt(req.params.id) },
            data: { role },
            select: { id: true, username: true, role: true } 
        });

        res.json({ status: 'ok', message: 'Роль успешно обновлена', user: updatedUser });
    } catch (error) {
        console.error('[Ошибка PATCH /users/:id/role]:', error);
        res.status(500).json({ error: 'Ошибка сервера при обновлении пользователя' });
    }
});

// ============================================================================
// 4. DELETE /:id - Удаление пользователя
// ============================================================================
router.delete('/:id', authenticate, requireWriteAccess, async (req, res) => {
    try {
        await prisma.user.delete({
            where: { id: parseInt(req.params.id) }
        });
        res.json({ status: 'ok', message: 'Пользователь удален' });
    } catch (error) {
        console.error('[Ошибка DELETE /users/:id]:', error);
        res.status(500).json({ error: 'Ошибка при удалении пользователя' });
    }
});

export default router;
