import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function main() {
  const passwordHash = await bcrypt.hash('admin123', 10) // Пароль будет admin123
  
  const admin = await prisma.user.create({
    data: {
      username: 'admin',
      password: passwordHash,
      role: 'ADMIN' // Используем enum значение
    }
  })
  console.log(`Пользователь ${admin.username} успешно создан с ролью ${admin.role}!`)
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect()
  })