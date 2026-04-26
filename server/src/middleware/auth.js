import jwt from 'jsonwebtoken'

const SECRET_KEY = process.env.JWT_SECRET || 'super_secret_farm_key_123'

function getRequestIp(req) {
  const forwardedFor = req.headers['x-forwarded-for']
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim()
  }

  return req.ip || req.socket?.remoteAddress || 'unknown'
}

function logAccessDenied(req, status, reason) {
  const details = {
    method: req.method,
    path: req.originalUrl || req.url,
    status,
    reason,
    ip: getRequestIp(req),
    userId: req.user?.id ?? null,
    role: req.user?.role ?? null,
    hasAuthorizationHeader: Boolean(req.headers.authorization),
    hasTokenCookie: Boolean(req.cookies?.token)
  }

  console.warn('[AUTH DENY]', JSON.stringify(details))
}

export function extractTokenFromRequest(req) {
  const authHeader = req.headers.authorization
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim()
    if (token) return token
  }

  const cookieToken = req.cookies?.token
  if (typeof cookieToken === 'string' && cookieToken.trim()) {
    return cookieToken.trim()
  }

  return ''
}

export function verifyAccessToken(token) {
  return jwt.verify(token, SECRET_KEY)
}

// 1. Проверка, что пользователь вообще вошел в систему (есть валидный токен)
export const authenticate = (req, res, next) => {
  const token = extractTokenFromRequest(req)
  if (!token) {
    logAccessDenied(req, 401, 'token_missing')
    return res.status(401).json({ error: 'Нет доступа: токен не предоставлен' })
  }

  try {
    const decoded = verifyAccessToken(token)
    req.user = decoded // Сохраняем { id, role } в req
    next()
  } catch (error) {
    logAccessDenied(req, 403, 'token_invalid')
    return res.status(403).json({ error: 'Неверный или просроченный токен' })
  }
}

// 2. Только для Админа
export const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'ADMIN') {
    logAccessDenied(req, 403, 'admin_required')
    return res.status(403).json({ error: 'Доступ запрещен: только для администраторов' })
  }
  next()
}

// 3. Для Директора и выше (Админа)
export const requireDirectorOrAdmin = (req, res, next) => {
  if (req.user?.role !== 'ADMIN' && req.user?.role !== 'DIRECTOR') {
    logAccessDenied(req, 403, 'director_required')
    return res.status(403).json({ error: 'Доступ запрещен: требуются права директора' })
  }
  next()
}

// 4. Для чтения данных (Админ, Директор, Гость)
export const requireReadAccess = (req, res, next) => {
  const allowedRoles = ['ADMIN', 'DIRECTOR', 'GUEST']
  if (!allowedRoles.includes(req.user?.role)) {
    logAccessDenied(req, 403, 'read_access_required')
    return res.status(403).json({ error: 'Доступ запрещен: недостаточно прав для чтения' })
  }
  next()
}

// 5. Для записи/редактирования данных (Админ, Директор)
export const requireWriteAccess = (req, res, next) => {
  const allowedRoles = ['ADMIN', 'DIRECTOR']
  if (!allowedRoles.includes(req.user?.role)) {
    logAccessDenied(req, 403, 'write_access_required')
    return res.status(403).json({ error: 'Доступ запрещен: недостаточно прав для редактирования' })
  }
  next()
}

// 6. Только для Админа (альтернатива requireAdmin для ясности)
export const requireAdminOnly = requireAdmin
