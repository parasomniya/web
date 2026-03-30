import { Router } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import prisma from '../../database.js'

const router = Router()
const SECRET_KEY = process.env.JWT_SECRET || 'super_secret_farm_key_123'

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body

    const user = await prisma.user.findUnique({ where: { username } })
    if (!user) return res.status(401).json({ error: 'Неверный логин или пароль' })

    const isValidPassword = await bcrypt.compare(password, user.password)
    if (!isValidPassword) return res.status(401).json({ error: 'Неверный логин или пароль' })

    // Генерируем токен на 24 часа
    const token = jwt.sign({ id: user.id, role: user.role }, SECRET_KEY, { expiresIn: '24h' })
    
    // Устанавливаем токен в cookie для доступа к защищенным страницам
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 24 часа
    })
    
    // Возвращаем токен и роль, чтобы фронтенд знал, какие вкладки показывать
    res.json({ token, role: user.role }) 
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

// Выход из системы (очистка cookie)
router.post('/logout', (req, res) => {
  res.clearCookie('token')
  res.json({ status: 'ok', message: 'Вы успешно вышли из системы' })
})

export default router