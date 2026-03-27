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
    
    // Возвращаем токен и роль, чтобы фронтенд знал, какие вкладки показывать
    res.json({ token, role: user.role }) 
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

export default router