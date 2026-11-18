import 'reflect-metadata';
import { config } from 'dotenv';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { migrate } from './db/data-source';

config();

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useBodyParser('json', { limit: '2mb' });
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.enableCors({
    origin: (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',').map((s) => s.trim()),
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableShutdownHooks();

  // Apply any pending TypeORM migrations before serving requests.
  if (process.env.RUN_MIGRATIONS !== 'false') {
    const applied = await migrate(app.get(DataSource));
    if (applied.length) Logger.log(`applied migrations: ${applied.join(', ')}`, 'Database');
  }

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  Logger.log(`Groundwork API on http://localhost:${port}/api`, 'Bootstrap');
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
