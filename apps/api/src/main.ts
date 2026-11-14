import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  // Локальний режим: роздача uploads з диска + Swagger не на проді.
  // На Vercel-серверлесі аналогічний конфіг живе в api/index.ts.
  configureApp(app, { staticUploads: true });

  const port = config.get<number>('PORT') ?? 3000;
  await app.listen(port);
}
void bootstrap();
