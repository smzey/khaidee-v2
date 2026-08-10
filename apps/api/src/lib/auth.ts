import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { unauthorized } from './errors.js';

const DEV_SECRET = 'dev-only-secret-change-before-deploying';
const SECRET = process.env.SESSION_SECRET ?? DEV_SECRET;

if (process.env.NODE_ENV === 'production' && SECRET === DEV_SECRET) {
  throw new Error('SESSION_SECRET must be set in production');
}

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

export const pinVersion = (pinHash: string): string =>
  createHmac('sha256', SECRET).update(`pin:${pinHash}`).digest('base64url');

/**
 * A stateless signed token: vendorId.expiry.pinVersion.signature. The version
 * is derived from the current PIN hash, so changing the PIN signs out old
 * phones without keeping a server-side session table.
 */
export function issueToken(
  vendorId: string,
  pinHash: string,
  now: number = Date.now(),
): string {
  const payload = `${vendorId}.${now + SESSION_TTL_MS}.${pinVersion(pinHash)}`;
  return `${payload}.${sign(payload)}`;
}

export function readToken(
  token: string | undefined,
  now: number = Date.now(),
): { vendorId: string; pinVersion: string } {
  if (!token) throw unauthorized();
  const parts = token.split('.');
  if (parts.length !== 4) throw unauthorized();
  const [vendorId, expiry, version, signature] = parts as [
    string,
    string,
    string,
    string,
  ];

  const expected = sign(`${vendorId}.${expiry}.${version}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw unauthorized();
  if (Number(expiry) < now) throw unauthorized();

  return { vendorId, pinVersion: version };
}

export function tokenMatchesPin(
  tokenVersion: string,
  currentPinHash: string,
): boolean {
  const expected = pinVersion(currentPinHash);
  const a = Buffer.from(tokenVersion);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Pulls the bearer token out of an Authorization header. */
export function bearer(header: string | undefined): string | undefined {
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length);
}
