import { Router } from 'express' // Роутер
import bcrypt from 'bcrypt' // Хеширование паролей
import jwt from 'jsonwebtoken' // Токены
import prisma from '../../database.js' //БД
import nodemailer from 'nodemailer' // Отправка email

const router = Router()
const SECRET_KEY = process.env.JWT_SECRET || 'super_secret_farm_key_123'

// Настройка почты
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT || 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

// ============== Авторизация ==============

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
      maxAge: 30 *24 * 60 * 60 * 1000 // 30 дней
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

// ==================== СБРОС ПАРОЛЯ ====================

// 1. Запрос на сброс (Юзер вводит логин)
router.post('/forgot-password', async (req, res) => {
  try {
    const { username } = req.body

    if (!username) {
      return res.status(400).json({ error: 'Укажите логин' })
    }

    const user = await prisma.user.findUnique({ where: { username } })
    
    // Если юзер не найден ИЛИ у него нет email в базе
    // Отвечаем одинаково, чтобы не давать хакерам информацию
    if (!user || !user.email) {
      return res.json({ 
        status: 'ok', 
        message: 'Инструкция отправлена на email' 
      })
    }

    // Секрет из ключа + текущего пароля (ссылка сгорит после смены пароля)
    const secret = SECRET_KEY + user.password
    const token = jwt.sign({ id: user.id, username: user.username }, secret, { expiresIn: '15m' })

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000'
    const resetLink = `${frontendUrl}/reset-password?token=${token}&id=${user.id}`

    // Отправляем реальное письмо на привязанный email
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: user.email,
      subject: 'Восстановление пароля',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Сброс пароля</h2>
          <p>Был запрошен сброс пароля для пользователя: <b>${user.username}</b></p>
          <p>Ссылка действительна <b>15 минут</b>.</p>
          <a href="${resetLink}" style="display:inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">Сбросить пароль</a>
        </div>
      `
    })

    console.log(`[СБРОС ПАРОЛЯ] Письмо отправлено на ${user.email} для логина ${user.username}`)
    
    res.json({ 
      status: 'ok', 
      message: 'на почту отправлена инструкция по сбросу пароля' 
    })

  } catch (error) {
    console.error('[Ошибка /forgot-password]:', error)
    res.status(500).json({ error: 'Ошибка сервера при отправке письма' })
  }
})

// 2. Установка нового пароля
router.post('/reset-password', async (req, res) => {
  try {
    const { id, token, newPassword } = req.body

    if (!id || !token || !newPassword) {
      return res.status(400).json({ error: 'Не все данные переданы' })
    }

    const user = await prisma.user.findUnique({ where: { id: parseInt(id) } })
    if (!user) {
      return res.status(400).json({ error: 'Пользователь не найден' })
    }

    const secret = SECRET_KEY + user.password

    try {
      jwt.verify(token, secret)
    } catch (err) {
      return res.status(400).json({ error: 'Ссылка устарела или уже была использована' })
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10)

    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedNewPassword }
    })

    res.json({ status: 'ok', message: 'Пароль успешно изменен. Теперь можно войти.' })

  } catch (error) {
    console.error('[Ошибка /reset-password]:', error)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

export default router