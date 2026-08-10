import { sql as drizzleSql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import type { Db } from '../db/client.js';
import { EventBroker } from '../lib/broker.js';
import {
  defaultProductionConfigEnv,
  validateProductionConfig,
} from '../lib/config.js';
import type { ErrorReporter } from '../lib/errorReporter.js';
import { HttpError } from '../lib/errors.js';
import {
  createApiLoggerOptions,
  requestLogLevelFor,
  sanitizeForLog,
  slowOperation,
} from '../lib/logging.js';
import { isRateLimitExemptPath } from '../lib/rateLimit.js';
import {
  resetSseStatsForTests,
  sseStatsSnapshot,
} from '../lib/sse.js';

const dbWithExecute = (execute: (query: unknown) => Promise<unknown>): Db =>
  ({ execute } as unknown as Db);

const appWithDb = (db: Db, reporter?: ErrorReporter) => {
  const options = {
    db,
    logger: false,
    narrator: null,
    assistant: null,
  };
  return buildApp(reporter ? { ...options, errorReporter: reporter } : options);
};

afterEach(() => {
  resetSseStatsForTests();
  vi.restoreAllMocks();
});

describe('production config validation', () => {
  it('refuses production without a real database URL and session secret', () => {
    expect(() =>
      validateProductionConfig({
        ...defaultProductionConfigEnv,
        NODE_ENV: 'production',
        DATABASE_URL: undefined,
        SESSION_SECRET: undefined,
      }),
    ).toThrow(/DATABASE_URL.*SESSION_SECRET/);
  });

  it('allows local database defaults outside production', () => {
    expect(
      validateProductionConfig({
        ...defaultProductionConfigEnv,
        NODE_ENV: 'test',
        DATABASE_URL: undefined,
        SESSION_SECRET: undefined,
      }),
    ).toMatchObject({ nodeEnv: 'test' });
  });

  it('requires a provider key when report AI is enabled', () => {
    expect(() =>
      validateProductionConfig({
        ...defaultProductionConfigEnv,
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://db.example/khaidee',
        SESSION_SECRET: 'prod-secret',
        KHAIDEE_REPORT_AI: 'true',
        ANTHROPIC_API_KEY: undefined,
        XAI_API_KEY: undefined,
      }),
    ).toThrow(/KHAIDEE_REPORT_AI.*ANTHROPIC_API_KEY.*XAI_API_KEY/);
  });
});

describe('sanitized logging', () => {
  it('redacts bearer tokens, pins, promptpay ids and AI prompts', () => {
    const sanitized = sanitizeForLog({
      headers: { authorization: 'Bearer vendor-token' },
      body: {
        pin: '1234',
        promptpayId: '0812345678',
        question: 'How much money did I make?',
        history: [{ role: 'user', content: 'secret thread' }],
        safe: 'kept',
      },
    });

    expect(sanitized).toEqual({
      headers: { authorization: '[redacted]' },
      body: {
        pin: '[redacted]',
        promptpayId: '[redacted]',
        question: '[redacted]',
        history: '[redacted]',
        safe: 'kept',
      },
    });
  });

  it('configures pino redaction paths for common secret locations', () => {
    const logger = createApiLoggerOptions();
    expect(JSON.stringify(logger.redact)).toContain('authorization');
    expect(JSON.stringify(logger.redact)).toContain('pin');
    expect(JSON.stringify(logger.redact)).toContain('promptpayId');
  });

  it('warns for expected client errors and errors for 5xx responses', () => {
    expect(requestLogLevelFor(401, 10)).toBe('warn');
    expect(requestLogLevelFor(423, 10)).toBe('warn');
    expect(requestLogLevelFor(500, 10)).toBe('error');
    expect(requestLogLevelFor(200, 1_001)).toBe('warn');
  });
});

describe('health and readiness', () => {
  it('keeps /health as process liveness without touching the database', async () => {
    const execute = vi.fn();
    const app = appWithDb(dbWithExecute(execute));
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(execute).not.toHaveBeenCalled();
    await app.close();
  });

  it('checks database readiness with select 1', async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const app = appWithDb(dbWithExecute(execute));
    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, database: 'ok' });
    expect(execute).toHaveBeenCalledWith(drizzleSql`select 1`);
    await app.close();
  });

  it('returns 503 when the database is not ready', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('db down'));
    const app = appWithDb(dbWithExecute(execute));
    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ ok: false, database: 'error' });
    await app.close();
  });
});

describe('error reporting', () => {
  it('reports only unexpected 500s and preserves the public response body', async () => {
    const reporter: ErrorReporter = { capture: vi.fn() };
    const app = appWithDb(dbWithExecute(vi.fn()), reporter);
    app.get('/boom', async () => {
      throw new Error('database password leaked in stack?');
    });

    const response = await app.inject({ method: 'GET', url: '/boom' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      code: 'internal_error',
      message: 'Something went wrong',
    });
    expect(reporter.capture).toHaveBeenCalledTimes(1);
    expect(reporter.capture).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        requestId: expect.any(String),
        method: 'GET',
        route: '/boom',
        statusCode: 500,
      }),
    );
    await app.close();
  });

  it('does not report expected 4xx errors', async () => {
    const reporter: ErrorReporter = { capture: vi.fn() };
    const app = appWithDb(dbWithExecute(vi.fn()), reporter);
    app.get('/expected', async () => {
      throw new HttpError(401, 'unauthorized', 'Sign in to the stall first');
    });

    const response = await app.inject({ method: 'GET', url: '/expected' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      code: 'unauthorized',
      message: 'Sign in to the stall first',
    });
    expect(reporter.capture).not.toHaveBeenCalled();
    await app.close();
  });

  it('still returns the safe 500 body when the reporter itself fails', async () => {
    const reporter: ErrorReporter = {
      capture() {
        throw new Error('reporter down');
      },
    };
    const app = appWithDb(dbWithExecute(vi.fn()), reporter);
    app.get('/reporter-fails', async () => {
      throw new Error('original failure');
    });

    const response = await app.inject({ method: 'GET', url: '/reporter-fails' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      code: 'internal_error',
      message: 'Something went wrong',
    });
    await app.close();
  });
});

describe('slow operation logging', () => {
  it('warns when an operation crosses the configured slow threshold', async () => {
    const warn = vi.fn();
    const result = await slowOperation(
      'orders.today',
      () => Promise.resolve('ok'),
      { warn },
      { thresholdMs: 0, now: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(125) },
    );

    expect(result).toBe('ok');
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'orders.today', durationMs: 25 }),
      'slow operation',
    );
  });
});

describe('edge rate limiting', () => {
  it('exempts both long-lived SSE routes from ordinary request limits', () => {
    expect(isRateLimitExemptPath('GET', '/vendor/stream')).toBe(true);
    expect(isRateLimitExemptPath('GET', '/orders/abc-123/stream')).toBe(true);
    expect(isRateLimitExemptPath('POST', '/s/teststall/orders')).toBe(false);
    expect(isRateLimitExemptPath('GET', '/health')).toBe(false);
  });
});

describe('SSE operational signals', () => {
  it('tracks broker subscribers and warns when a vendor has no live queue', () => {
    const warn = vi.fn();
    const broker = new EventBroker({ logger: { warn } });
    const unsubscribe = broker.subscribe('vendor-1', () => {});

    expect(broker.subscriberCount('vendor-1')).toBe(1);
    unsubscribe();
    expect(broker.subscriberCount('vendor-1')).toBe(0);

    broker.publish('vendor-1', {
      id: 1,
      type: 'order.placed',
      order: { id: 'order-1', vendorId: 'vendor-1' } as never,
    });

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ vendorId: 'vendor-1', eventType: 'order.placed' }),
      'vendor has no live SSE subscribers',
    );
  });

  it('exposes resettable SSE counters for stream lifecycle logs', () => {
    expect(sseStatsSnapshot()).toEqual({
      vendor: { current: 0, opened: 0, closed: 0, sendFailures: 0 },
      customer: { current: 0, opened: 0, closed: 0, sendFailures: 0 },
    });
  });
});
