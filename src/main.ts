import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: [
      'http://localhost:5173',
      'https://agrifas-561ea.web.app',
      'https://agrifas-561ea.firebaseapp.com',
    ],
    credentials: true,
  });

  await app.listen(3000);
  console.log('🚀 Servidor rodando na porta 3000');
}
bootstrap();