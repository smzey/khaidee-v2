import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { IllegalTransitionError, PaymentRequiredError } from '@khaidee/domain';
import { sql as drizzleSql } from 'drizzle-orm';
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyServerOptions,
  type FastifyRequest,
  type FastifyReply,
} from 'fastify';
import { ZodError } from 'zod';
import type { Db } from './db/client.js';
import {
  type Assistant,
  assistantConfigured,
  configuredAssistant,
} from './lib/assistant.js';
import { EventBroker } from './lib/broker.js';
import {
  type ErrorReporter,
  noopErrorReporter,
} from './lib/errorReporter.js';
import { HttpError } from './lib/errors.js';
import { MAX_UPLOAD_BYTES, UPLOAD_DIR } from './lib/images.js';
import {
  createRequestId,
  installRequestLogging,
  markResponseErrorCode,
  requestContextForLog,
} from './lib/logging.js';
import {
  configuredNarrator,
  type Narrator,
  narratorConfigured,
} from './lib/narrator.js';
import { installEdgeRateLimit, type EdgeRateLimitOptions } from './lib/rateLimit.js';
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
  logger?: FastifyServerOptions['logger'];
  errorReporter?: ErrorReporter;
  rateLimit?: EdgeRateLimitOptions | false;
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
  errorReporter = noopErrorReporter,
  rateLimit,
  narrator,
  assistant,
  weatherClient,
}: BuildOptions): FastifyInstance {
  const app = Fastify({
    logger,
    logController: new LogController({ disableRequestLogging: true }),
    genReqId: createRequestId,
  });
  installRequestLogging(app);
  if (rateLimit !== false) installEdgeRateLimit(app, rateLimit);

  const broker = new EventBroker({ logger: app.log });
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
  app.get('/ready', async (_request, reply) => {
    try {
      await db.execute(drizzleSql`select 1`);
      return { ok: true, database: 'ok' };
    } catch (error) {
      reply.code(503);
      return { ok: false, database: 'error' };
    }
  });

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
  const sendError = (
    request: FastifyRequest,
    reply: FastifyReply,
    status: number,
    payload: { code: string; message: string; details?: unknown },
  ) => {
    markResponseErrorCode(request, payload.code);
    return reply.code(status).send(payload);
  };

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return sendError(request, reply, error.status, {
        code: error.code,
        message: error.message,
        details: error.details,
      });
    }

    if (error instanceof IllegalTransitionError) {
      return sendError(request, reply, 409, {
        code: 'illegal_transition',
        message: error.message,
        details: { from: error.from, to: error.to },
      });
    }

    if (error instanceof PaymentRequiredError) {
      return sendError(request, reply, 422, {
        code: 'payment_required',
        message: error.message,
      });
    }

    if (error instanceof ZodError) {
      return sendError(request, reply, 400, {
        code: 'invalid_request',
        message: 'That request did not look right',
        details: error.issues,
      });
    }

    // Multipart rejects an oversized upload before any handler sees it.
    if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
      return sendError(request, reply, 413, {
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
      return sendError(request, reply, tagged, {
        code: (error as { code?: string }).code ?? 'bad_request',
        message: (error as { message?: string }).message ?? 'That request did not look right',
      });
    }

    markResponseErrorCode(request, 'internal_error');
    try {
      errorReporter.capture(error, {
        ...requestContextForLog(request, 500, 'internal_error'),
        statusCode: 500,
      });
    } catch (reportError) {
      request.log.warn({ err: reportError }, 'error reporter failed');
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply
      .code(500)
      .send({ code: 'internal_error', message: 'Something went wrong' });
  });

  return app;
}
