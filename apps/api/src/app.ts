import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { IllegalTransitionError, PaymentRequiredError } from '@khaidee/domain';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { Db } from './db/client.js';
import {
  type Assistant,
  assistantConfigured,
  configuredAssistant,
} from './lib/assistant.js';
import { EventBroker } from './lib/broker.js';
import { HttpError } from './lib/errors.js';
import { MAX_UPLOAD_BYTES, UPLOAD_DIR } from './lib/images.js';
import {
  configuredNarrator,
  type Narrator,
  narratorConfigured,
} from './lib/narrator.js';
import { registerRoutes } from './routes/register.js';
import { storefrontRoutes } from './routes/storefront.js';
import { vendorRoutes } from './routes/vendor.js';
import { AssistantService } from './services/assistant.js';
import { ForecastService, type WeatherClient } from './services/forecast.js';
import { MenuService } from './services/menu.js';
import { OrderService } from './services/orders.js';
import { PushService } from './services/push.js';
import { ReportService } from './services/reports.js';
import { VendorService } from './services/vendors.js';

export interface BuildOptions {
  db: Db;
  logger?: boolean;
  /**
   * Injected in tests so the suite never reaches the network. In production
   * this is left out and built from the configured AI provider, if enabled.
   */
  narrator?: Narrator | null;
  /** Same contract as `narrator`: undefined reads the env, null disables it. */
  assistant?: Assistant | null;
  weatherClient?: WeatherClient;
}

export function buildApp({
  db,
  logger = false,
  narrator,
  assistant,
  weatherClient,
}: BuildOptions): FastifyInstance {
  const app = Fastify({ logger });
  const broker = new EventBroker();
  const menuService = new MenuService(db);
  const orderService = new OrderService(db, broker, menuService);
  const pushService = new PushService(db);
  const vendorService = new VendorService(db);
  // Undefined means "decide from the environment"; explicit null means the
  // deterministic template writer, which keeps dev/demo report notes free.
  const resolvedNarrator =
    narrator === undefined
      ? narratorConfigured()
        ? configuredNarrator()
        : null
      : narrator;
  const reportService = new ReportService(db, resolvedNarrator);
  const forecastService = new ForecastService(db, menuService, weatherClient);
  const resolvedAssistant =
    assistant === undefined
      ? assistantConfigured()
        ? configuredAssistant()
        : null
      : assistant;
  const assistantService = new AssistantService(
    reportService,
    menuService,
    orderService,
    resolvedAssistant,
  );

  // The customer page is served from a different origin to the API, and the
  // QR is public by design — there are no cookies to protect here.
  app.register(cors, { origin: true });
  app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
  app.register(fastifyStatic, {
    root: UPLOAD_DIR,
    prefix: '/uploads/',
    // Dish photos are content-addressed by a fresh UUID per upload, so a URL
    // never changes meaning and can be cached hard.
    maxAge: '365d',
    immutable: true,
  });

  app.get('/health', async () => ({ ok: true }));

  storefrontRoutes(app, orderService, menuService, broker, pushService);
  vendorRoutes(
    app,
    orderService,
    menuService,
    vendorService,
    broker,
    pushService,
    reportService,
    forecastService,
    assistantService,
  );
  registerRoutes(app, vendorService, orderService);

  /**
   * One place where domain errors become status codes. Handlers throw and say
   * nothing about HTTP; this decides what the wire sees.
   */
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply
        .code(error.status)
        .send({ code: error.code, message: error.message, details: error.details });
    }

    if (error instanceof IllegalTransitionError) {
      return reply.code(409).send({
        code: 'illegal_transition',
        message: error.message,
        details: { from: error.from, to: error.to },
      });
    }

    if (error instanceof PaymentRequiredError) {
      return reply
        .code(422)
        .send({ code: 'payment_required', message: error.message });
    }

    if (error instanceof ZodError) {
      return reply.code(400).send({
        code: 'invalid_request',
        message: 'That request did not look right',
        details: error.issues,
      });
    }

    // Multipart rejects an oversized upload before any handler sees it.
    if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({
        code: 'image_too_large',
        message: 'That picture is too big. Try taking it again.',
      });
    }

    /*
     * Fastify rejects malformed requests before any handler runs — an empty
     * body sent with a JSON content-type, unparseable JSON — and tags them
     * with the status they deserve. Without this they fell through to the 500
     * below, so a client with a header bug was told "something went wrong"
     * instead of what was actually wrong with its request.
     */
    const tagged = (error as { statusCode?: number }).statusCode;
    if (typeof tagged === 'number' && tagged >= 400 && tagged < 500) {
      return reply.code(tagged).send({
        code: (error as { code?: string }).code ?? 'bad_request',
        message: (error as { message?: string }).message ?? 'That request did not look right',
      });
    }

    request.log.error({ err: error }, 'unhandled error');
    return reply
      .code(500)
      .send({ code: 'internal_error', message: 'Something went wrong' });
  });

  return app;
}
