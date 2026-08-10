import type { FastifyInstance } from 'fastify';
import { HttpError } from './errors.js';

export interface EdgeRateLimitOptions {
  max: number;
  windowMs: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export function isRateLimitExemptPath(method: string, url: string): boolean {
  if (method !== 'GET') return false;
  const pathname = url.split('?')[0] ?? url;
  return pathname === '/vendor/stream' || /^\/orders\/[^/]+\/stream$/.test(pathname);
}

export function installEdgeRateLimit(
  app: FastifyInstance,
  options: EdgeRateLimitOptions = { max: 600, windowMs: 60_000 },
): void {
  const buckets = new Map<string, Bucket>();

  app.addHook('onRequest', async (request) => {
    if (isRateLimitExemptPath(request.method, request.url)) return;

    const now = Date.now();
    const key = `${request.ip}:${request.method}:${request.routeOptions?.url ?? request.url}`;
    const found = buckets.get(key);
    if (!found || found.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return;
    }

    found.count += 1;
    if (found.count > options.max) {
      throw new HttpError(429, 'rate_limited', 'Too many requests. Try again shortly');
    }
  });
}
