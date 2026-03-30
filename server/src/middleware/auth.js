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

// 4. Для чтения данных (Админ, Директор, Гость)
export const requireReadAccess = (req, res, next) => {
  const allowedRoles = ['ADMIN', 'DIRECTOR', 'GUEST']
  if (!allowedRoles.includes(req.user?.role)) {
    return res.status(403).json({ error: 'Доступ запрещен: недостаточно прав для чтения' })
  }
  next()
}

// 5. Для записи/редактирования данных (Админ, Директор)
export const requireWriteAccess = (req, res, next) => {
  const allowedRoles = ['ADMIN', 'DIRECTOR']
  if (!allowedRoles.includes(req.user?.role)) {
    return res.status(403).json({ error: 'Доступ запрещен: недостаточно прав для редактирования' })
  }
  next()
}

// 6. Только для Админа (альтернатива requireAdmin для ясности)
export const requireAdminOnly = requireAdmin