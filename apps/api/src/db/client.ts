import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://localhost:5432/khaidee_dev';

export function createDb(url: string = DATABASE_URL) {
  const sql = postgres(url, { max: 10 });
  return { db: drizzle(sql, { schema }), sql };
}

export type Db = ReturnType<typeof createDb>['db'];
