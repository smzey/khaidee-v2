import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { unauthorized } from './errors.js';

const SECRET =
  process.env.SESSION_SECRET ?? 'dev-only-secret-change-before-deploying';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // a month; a stall signs in rarely

export function hashPin(pin: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(pin, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [salt, expected] = stored.split(':');
  if (!salt || !expected) return false;
  const derived = scryptSync(pin, salt, 64);
  const expectedBuf = Buffer.from(expected, 'hex');
  if (derived.length !== expectedBuf.length) return false;
  return timingSafeEqual(derived, expectedBuf);
}

const sign = (payload: string): string =>
  createHmac('sha256', SECRET).update(payload).digest('base64url');

/**
 * A stateless signed token: vendorId.expiry.signature. No session table to
 * keep, and a stall phone that has been offline for a week still comes back
 * signed in.
 */
export function issueToken(vendorId: string, now: number = Date.now()): string {
  const payload = `${vendorId}.${now + SESSION_TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

export function readToken(
  token: string | undefined,
  now: number = Date.now(),
): string {
  if (!token) throw unauthorized();
  const parts = token.split('.');
  if (parts.length !== 3) throw unauthorized();
  const [vendorId, expiry, signature] = parts as [string, string, string];

  const expected = sign(`${vendorId}.${expiry}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw unauthorized();
  if (Number(expiry) < now) throw unauthorized();

  return vendorId;
}

/** Pulls the bearer token out of an Authorization header. */
export function bearer(header: string | undefined): string | undefined {
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length);
}
