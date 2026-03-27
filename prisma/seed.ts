import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const adminEmail = 'admin@agrifas.com';
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });

  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash('Admin123!', 10);
    await prisma.user.create({
      data: {
        name: 'Admin Supremo',
        email: adminEmail,
        passwordHash,
        role: UserRole.ADMIN,
      },
    });
    console.log('✅ Admin inicial criado com sucesso: admin@agrifas.com / Admin123!');
  } else {
    console.log('⚠️ Admin inicial já existe no banco de dados.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });