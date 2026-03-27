import jwt from 'jsonwebtoken'

const SECRET_KEY = process.env.JWT_SECRET || 'super_secret_farm_key_123'

// 1. Проверка, что пользователь вообще вошел в систему (есть валидный токен)
export const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization
  if (!authHeader) {
    return res.status(401).json({ error: 'Нет доступа: токен не предоставлен' })
  }

  const token = authHeader.split(' ')[1]

  try {
    const decoded = jwt.verify(token, SECRET_KEY)
    req.user = decoded // Сохраняем { id, role } в req
    next()
  } catch (error) {
    return res.status(403).json({ error: 'Неверный или просроченный токен' })
  }
}

// 2. Только для Админа
export const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Доступ запрещен: только для администраторов' })
  }
  next()
}

// 3. Для Директора и выше (Админа)
export const requireDirectorOrAdmin = (req, res, next) => {
  if (req.user?.role !== 'ADMIN' && req.user?.role !== 'DIRECTOR') {
    return res.status(403).json({ error: 'Доступ запрещен: требуются права директора' })
  }
  next()
}