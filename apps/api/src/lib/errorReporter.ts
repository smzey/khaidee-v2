import { randomUUID } from 'node:crypto';
import { sanitizeForLog } from './logging.js';

export interface ErrorReporter {
  capture(error: unknown, context: Record<string, unknown>): void;
}

export const noopErrorReporter: ErrorReporter = {
  capture() {
    // Intentionally empty: tests and local development should not phone home.
  },
};

interface ReporterLogger {
  warn(fields: Record<string, unknown>, message: string): void;
}

interface SentryDsn {
  endpoint: string;
  publicKey: string;
}

function parseSentryDsn(dsn: string): SentryDsn {
  const url = new URL(dsn);
  const publicKey = url.username;
  const projectId = url.pathname.split('/').filter(Boolean).pop();
  if (!publicKey || !projectId) throw new Error('SENTRY_DSN is invalid');
  const basePath = url.pathname.replace(new RegExp(`/${projectId}/?$`), '');
  return {
    endpoint: `${url.protocol}//${url.host}${basePath}/api/${projectId}/envelope/`,
    publicKey,
  };
}

function errorEvent(error: unknown, context: Record<string, unknown>) {
  const err = error instanceof Error ? error : new Error(String(error));
  return {
    event_id: randomUUID().replaceAll('-', ''),
    timestamp: new Date().toISOString(),
    platform: 'node',
    level: 'error',
    exception: {
      values: [
        {
          type: err.name,
          value: err.message,
          stacktrace: err.stack ? { frames: [] } : undefined,
        },
      ],
    },
    contexts: { khaidee: sanitizeForLog(context) },
  };
}

class SentryEnvelopeReporter implements ErrorReporter {
  constructor(
    private readonly dsn: SentryDsn,
    private readonly logger?: ReporterLogger,
  ) {}

  capture(error: unknown, context: Record<string, unknown>): void {
    const event = errorEvent(error, context);
    const envelope = [
      JSON.stringify({ sent_at: new Date().toISOString() }),
      JSON.stringify({ type: 'event' }),
      JSON.stringify(event),
    ].join('\n');

    void fetch(this.dsn.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-sentry-envelope',
        'x-sentry-auth':
          `Sentry sentry_version=7, sentry_key=${this.dsn.publicKey}, sentry_client=khaidee-api/2.0.0`,
      },
      body: envelope,
    }).catch((reportError) => {
      this.logger?.warn(
        { err: reportError instanceof Error ? reportError.message : String(reportError) },
        'error reporter failed',
      );
    });
  }
}

export function createErrorReporter(
  env: { SENTRY_DSN?: string } = process.env,
  logger?: ReporterLogger,
): ErrorReporter {
  if (!env.SENTRY_DSN) return noopErrorReporter;
  return new SentryEnvelopeReporter(parseSentryDsn(env.SENTRY_DSN), logger);
}

export function installProcessErrorHandlers(
  reporter: ErrorReporter,
  logger: ReporterLogger = console,
): void {
  process.on('unhandledRejection', (reason) => {
    reporter.capture(reason, { source: 'unhandledRejection' });
    logger.warn({ err: reason instanceof Error ? reason.message : String(reason) }, 'unhandled rejection');
  });

  process.on('uncaughtException', (error) => {
    reporter.capture(error, { source: 'uncaughtException' });
    logger.warn({ err: error.message }, 'uncaught exception');
    process.exit(1);
  });
}
