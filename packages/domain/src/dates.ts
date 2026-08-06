/**
 * A stall's books close by local calendar day, not by UTC. Every date in the
 * system is derived here from a server instant plus the vendor's timezone,
 * never from a device clock — a phone with the wrong date must not be able to
 * file a sale under the wrong day.
 */
export const DEFAULT_TIME_ZONE = 'Asia/Bangkok';

/** YYYY-MM-DD for the given instant in the given timezone. */
export function businessDate(
  at: Date | string,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  const instant = typeof at === 'string' ? new Date(at) : at;
  if (Number.isNaN(instant.getTime())) {
    throw new TypeError(`Not a valid instant: ${String(at)}`);
  }
  // en-CA renders ISO-shaped dates (2026-08-05) in every ICU build.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Clock time as the vendor reads it, for the queue screen. */
export function localTime(
  at: Date | string,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  const instant = typeof at === 'string' ? new Date(at) : at;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(instant);
}

/**
 * The hour of the local clock, 0–23, for bucketing a day's trade.
 *
 * Derived the same way as businessDate rather than from getHours(), because a
 * server in UTC reading a Bangkok stall's lunch rush must not file it at 05:00.
 */
export function localHour(
  at: Date | string,
  timeZone: string = DEFAULT_TIME_ZONE,
): number {
  const instant = typeof at === 'string' ? new Date(at) : at;
  if (Number.isNaN(instant.getTime())) {
    throw new TypeError(`Not a valid instant: ${String(at)}`);
  }
  const rendered = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hour12: false,
  }).format(instant);
  // en-GB renders midnight as "24" in some ICU builds.
  return Number.parseInt(rendered, 10) % 24;
}

/** Whole minutes between two instants, floored. Drives "waiting 6 min". */
export function minutesBetween(from: Date | string, to: Date | string): number {
  const a = typeof from === 'string' ? new Date(from) : from;
  const b = typeof to === 'string' ? new Date(to) : to;
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / 60_000));
}
