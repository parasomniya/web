// src/middleware/auth.js

export const authMiddleware = (req, res, next) => {
    const token = req.headers.authorization
    
    // Для MVP: простой хардкод токен
    // В продакшене здесь будет проверка JWT
    if (token !== 'Bearer token') {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    
    // Токен верный — пропускаем запрос дальше
    next()
  }