const LOCAL_DATABASE_URL = 'postgres://localhost:5432/khaidee_dev';

export interface ProductionConfigEnv {
  NODE_ENV?: string | undefined;
  DATABASE_URL?: string | undefined;
  SESSION_SECRET?: string | undefined;
  SENTRY_DSN?: string | undefined;
  UPLOAD_DIR?: string | undefined;
  KHAIDEE_REPORT_AI?: string | undefined;
  KHAIDEE_REPORT_MODEL?: string | undefined;
  KHAIDEE_REPORT_XAI_MODEL?: string | undefined;
  KHAIDEE_ASSISTANT_MODEL?: string | undefined;
  KHAIDEE_ASSISTANT_XAI_MODEL?: string | undefined;
  ANTHROPIC_API_KEY?: string | undefined;
  XAI_API_KEY?: string | undefined;
  LOG_LEVEL?: string | undefined;
  SLOW_QUERY_MS?: string | undefined;
  EDGE_RATE_LIMIT_MAX?: string | undefined;
  EDGE_RATE_LIMIT_WINDOW_MS?: string | undefined;
}

export const defaultProductionConfigEnv: ProductionConfigEnv = {};

export interface ProductionConfig {
  nodeEnv: string;
  databaseUrl: string;
  sessionSecret: string | undefined;
  sentryDsn: string | undefined;
  slowQueryMs: number;
  edgeRateLimit: { max: number; windowMs: number };
}

function blank(value: string | undefined): boolean {
  return value === undefined || value.trim() === '';
}

function numberFromEnv(
  value: string | undefined,
  fallback: number,
  name: string,
  errors: string[],
): number {
  if (blank(value)) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    errors.push(`${name} must be a positive number`);
    return fallback;
  }
  return parsed;
}

function hasAiProvider(env: ProductionConfigEnv): boolean {
  return !blank(env.ANTHROPIC_API_KEY) || !blank(env.XAI_API_KEY);
}

export function validateProductionConfig(
  env: ProductionConfigEnv = process.env,
): ProductionConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const production = nodeEnv === 'production';
  const errors: string[] = [];

  if (production && blank(env.DATABASE_URL)) {
    errors.push('DATABASE_URL must be set in production');
  }
  if (production && blank(env.SESSION_SECRET)) {
    errors.push('SESSION_SECRET must be set in production');
  }
  if (production && env.KHAIDEE_REPORT_AI === 'true' && !hasAiProvider(env)) {
    errors.push(
      'KHAIDEE_REPORT_AI=true requires ANTHROPIC_API_KEY or XAI_API_KEY',
    );
  }
  if (
    production &&
    (!blank(env.KHAIDEE_ASSISTANT_MODEL) ||
      !blank(env.KHAIDEE_ASSISTANT_XAI_MODEL)) &&
    !hasAiProvider(env)
  ) {
    errors.push(
      'KHAIDEE_ASSISTANT_MODEL requires ANTHROPIC_API_KEY or XAI_API_KEY',
    );
  }

  const slowQueryMs = numberFromEnv(
    env.SLOW_QUERY_MS,
    500,
    'SLOW_QUERY_MS',
    errors,
  );
  const edgeMax = numberFromEnv(
    env.EDGE_RATE_LIMIT_MAX,
    600,
    'EDGE_RATE_LIMIT_MAX',
    errors,
  );
  const edgeWindowMs = numberFromEnv(
    env.EDGE_RATE_LIMIT_WINDOW_MS,
    60_000,
    'EDGE_RATE_LIMIT_WINDOW_MS',
    errors,
  );

  if (errors.length > 0) throw new Error(errors.join('; '));

  return {
    nodeEnv,
    databaseUrl: env.DATABASE_URL ?? LOCAL_DATABASE_URL,
    sessionSecret: env.SESSION_SECRET,
    sentryDsn: blank(env.SENTRY_DSN) ? undefined : env.SENTRY_DSN,
    slowQueryMs,
    edgeRateLimit: { max: edgeMax, windowMs: edgeWindowMs },
  };
}

export function databaseUrlFromEnv(
  env: ProductionConfigEnv = process.env,
): string {
  return validateProductionConfig(env).databaseUrl;
}
