import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import { databaseUrlFromEnv, validateProductionConfig } from '../lib/config.js';

export const DATABASE_URL = databaseUrlFromEnv();

interface DbLogger {
  warn(fields: Record<string, unknown>, message: string): void;
}

export function createDb(
  url: string = DATABASE_URL,
  options: { logger?: DbLogger; slowQueryMs?: number } = {},
) {
  const config = validateProductionConfig();
  const slowQueryMs = options.slowQueryMs ?? config.slowQueryMs;
  const sql = postgres(url, { max: 10 });
  void sql.unsafe(`set log_min_duration_statement = ${slowQueryMs}`).catch((error) => {
    options.logger?.warn(
      {
        err: error instanceof Error ? error.message : String(error),
        slowQueryMs,
      },
      'database slow-query logging could not be configured for this connection',
    );
  });
  return { db: drizzle(sql, { schema }), sql };
}

export type Db = ReturnType<typeof createDb>['db'];
