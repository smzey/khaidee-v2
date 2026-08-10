import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { bearer, readToken } from './auth.js';

const REDACTED = '[redacted]';
const SLOW_REQUEST_MS = 1_000;
const VERY_SLOW_REQUEST_MS = 5_000;

export const REDACT_PATHS = [
  'req.headers.authorization',
  'headers.authorization',
  'request.headers.authorization',
  'authorization',
  'body.pin',
  'req.body.pin',
  'request.body.pin',
  'body.promptpayId',
  'req.body.promptpayId',
  'request.body.promptpayId',
  'body.question',
  'body.history',
];

const SECRET_KEYS = new Set([
  'authorization',
  'pin',
  'promptpayid',
  'promptpay_id',
  'question',
  'history',
  'messages',
  'prompt',
]);

export interface LogLike {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

type Level = 'info' | 'warn' | 'error';

const starts = new WeakMap<FastifyRequest, bigint>();
const responseCodes = new WeakMap<FastifyRequest, string>();

export function createRequestId(request: { headers: Record<string, unknown> }): string {
  const raw = request.headers['x-request-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.trim() ? value : randomUUID();
}

export function sanitizeForLog(value: unknown, key = ''): unknown {
  if (SECRET_KEYS.has(key.toLowerCase())) return REDACTED;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLog(item));
  }
  if (!value || typeof value !== 'object') return value;

  const sanitized: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    sanitized[childKey] = sanitizeForLog(childValue, childKey);
  }
  return sanitized;
}

export function createApiLoggerOptions() {
  return {
    level: process.env.LOG_LEVEL ?? 'info',
    redact: { paths: REDACT_PATHS, censor: REDACTED },
    serializers: {
      req(request: FastifyRequest) {
        return requestContextForLog(request);
      },
      res(reply: { statusCode?: number }) {
        return reply.statusCode === undefined ? {} : { statusCode: reply.statusCode };
      },
      err(error: Error) {
        return {
          type: error.name,
          message: error.message,
          stack: error.stack ?? '',
        };
      },
    },
  };
}

export function markResponseErrorCode(
  request: FastifyRequest,
  code: string,
): void {
  responseCodes.set(request, code);
}

export function requestContextForLog(
  request: FastifyRequest,
  statusCode?: number,
  code?: string,
): Record<string, unknown> {
  const route = request.routeOptions?.url ?? request.url;
  return {
    requestId: request.id,
    method: request.method,
    route,
    statusCode,
    code,
    vendorId: vendorIdFromRequest(request),
  };
}

function vendorIdFromRequest(request: FastifyRequest): string | undefined {
  try {
    return readToken(bearer(request.headers.authorization)).vendorId;
  } catch {
    return undefined;
  }
}

export function requestLogLevelFor(statusCode: number, durationMs: number): Level {
  if (statusCode >= 500 || durationMs >= VERY_SLOW_REQUEST_MS) return 'error';
  if (statusCode >= 400 || durationMs >= SLOW_REQUEST_MS) return 'warn';
  return 'info';
}

export function installRequestLogging(app: FastifyInstance): void {
  app.addHook('onRequest', async (request) => {
    starts.set(request, process.hrtime.bigint());
  });

  app.addHook('onResponse', async (request, reply) => {
    const started = starts.get(request) ?? process.hrtime.bigint();
    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    const statusCode = reply.statusCode;
    const code = responseCodes.get(request);
    const fields = {
      ...requestContextForLog(request, statusCode, code),
      durationMs: Math.round(durationMs),
    };
    request.log[requestLogLevelFor(statusCode, durationMs)](
      fields,
      'request completed',
    );
  });
}

export async function slowOperation<T>(
  operation: string,
  run: () => Promise<T>,
  logger: Pick<LogLike, 'warn'>,
  options: { thresholdMs?: number; now?: () => number } = {},
): Promise<T> {
  const thresholdMs = options.thresholdMs ?? 500;
  const now = options.now ?? Date.now;
  const started = now();
  try {
    return await run();
  } finally {
    const durationMs = now() - started;
    if (durationMs >= thresholdMs) {
      logger.warn({ operation, durationMs }, 'slow operation');
    }
  }
}
