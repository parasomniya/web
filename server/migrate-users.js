import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function migrateUsers() {
  console.log('Начинаем миграцию пользователей...')
  
  // Получаем всех пользователей
  const users = await prisma.user.findMany()
  console.log(`Найдено ${users.length} пользователей`)
  
  let migrated = 0
  let errors = 0
  
  for (const user of users) {
    try {
      // Преобразуем старые роли в новые enum значения
      let newRole = 'GUEST' // значение по умолчанию
      
      if (user.role === 'ADMIN' || user.role === 'admin') {
        newRole = 'ADMIN'
      } else if (user.role === 'DIRECTOR' || user.role === 'director') {
        newRole = 'DIRECTOR'
      } else if (user.role === 'USER' || user.role === 'user') {
        // Старые USER становятся GUEST
        newRole = 'GUEST'
      }
      // Остальные значения остаются как есть (должны быть одним из: ADMIN, DIRECTOR, GUEST)
      
      // Обновляем пользователя
      await prisma.user.update({
        where: { id: user.id },
        data: { role: newRole }
      })
      
      console.log(`Пользователь ${user.username}: ${user.role} -> ${newRole}`)
      migrated++
      
    } catch (error) {
      console.error(`Ошибка при миграции пользователя ${user.username}:`, error.message)
      errors++
    }
  }
  
  console.log(`\nМиграция завершена!`)
  console.log(`Успешно: ${migrated}`)
  console.log(`Ошибок: ${errors}`)
  
  if (errors > 0) {
    console.log('\nВНИМАНИЕ: Были ошибки при миграции. Проверьте логи выше.')
  }
}

migrateUsers()
  .catch(e => console.error('Критическая ошибка:', e))
  .finally(async () => {
    await prisma.$disconnect()
  })