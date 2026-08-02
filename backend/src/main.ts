import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import helmet from 'helmet';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { CorrelationInterceptor } from './common/interceptors/correlation.interceptor';
import type { Request, Response } from 'express';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  // ── Security ────────────────────────────────────────────────
  app.use(helmet());

  // ── Proxy awareness ─────────────────────────────────────────
  // The rate limiter keys on the client IP. Behind a proxy (Render, and
  // Cloudflare in front of it) req.ip is the *proxy's* address unless Express
  // is told how many hops to trust — every caller would then share a single
  // bucket and one noisy client would lock out everyone.
  //
  // The hop count is configurable because it is deployment-specific and both
  // directions are harmful: too low collapses all clients into one bucket,
  // too high lets a caller spoof X-Forwarded-For and slip the limit entirely.
  // Verify against the live topology rather than assuming this default.
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 1);
  app.getHttpAdapter().getInstance().set('trust proxy', trustProxyHops);

  // ── CORS ────────────────────────────────────────────────────
  // Strip ALL whitespace (spaces, newlines, tabs) that can sneak into
  // FRONTEND_URL via copy-paste in a hosting dashboard. A URL never contains
  // whitespace, and a stray one produces an invalid Access-Control-Allow-Origin
  // header that 500s every request.
  const frontendOrigin = (
    process.env.FRONTEND_URL ?? 'http://localhost:3000'
  ).replace(/\s+/g, '');
  app.enableCors({
    origin: frontendOrigin,
    credentials: true,
  });

  // ── Global Prefix ────────────────────────────────────────────
  app.setGlobalPrefix('api/v1');

  // ── Root landing ─────────────────────────────────────────────
  // Sits outside the /api/v1 prefix so opening the base URL returns useful
  // info with a 200 instead of a 404 — this is an API, not a web page.
  app
    .getHttpAdapter()
    .getInstance()
    .get('/', (_req: Request, res: Response) => {
      res.json({
        name: 'CommercePilot API',
        status: 'ok',
        documentation: '/api/docs',
        health: '/api/v1/health',
      });
    });

  // ── Global Pipes ─────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown properties
      forbidNonWhitelisted: true, // throw on unknown properties
      transform: true, // auto-transform payloads to DTO types
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // ── Global Filters ───────────────────────────────────────────
  app.useGlobalFilters(new GlobalExceptionFilter());

  // ── Global Interceptors ──────────────────────────────────────
  app.useGlobalInterceptors(new CorrelationInterceptor());

  // ── Swagger Configuration ────────────────────────────────────
  const config = new DocumentBuilder()
    .setTitle('CommercePilot API')
    .setDescription('The CommercePilot API for WhatsApp-first businesses')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT ?? 3001;
  await app.listen(port);

  logger.log(
    `🚀 CommercePilot API running on: http://localhost:${port}/api/v1`,
  );
  logger.log(`📚 Swagger documentation: http://localhost:${port}/api/docs`);
  logger.log(`📧 MailHog web UI: http://localhost:8025`);
  logger.log(`🌍 Environment: ${process.env.NODE_ENV ?? 'development'}`);
}

bootstrap();
