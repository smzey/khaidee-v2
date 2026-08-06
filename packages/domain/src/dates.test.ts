import { describe, expect, it } from 'vitest';
import { businessDate, localTime, minutesBetween } from './dates.js';

describe('businessDate', () => {
  it('uses Bangkok local time, not UTC', () => {
    // 23:30 UTC is already 06:30 the next morning in Bangkok (UTC+7).
    expect(businessDate('2026-08-05T23:30:00.000Z')).toBe('2026-08-06');
  });

  it('keeps a late-evening Bangkok sale on the same day', () => {
    // 15:00 UTC is 22:00 Bangkok — still the 5th.
    expect(businessDate('2026-08-05T15:00:00.000Z')).toBe('2026-08-05');
  });

  it('renders as YYYY-MM-DD', () => {
    expect(businessDate('2026-01-02T05:00:00.000Z')).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });

  it('accepts a Date as well as a string', () => {
    expect(businessDate(new Date('2026-08-05T05:00:00.000Z'))).toBe(
      '2026-08-05',
    );
  });

  it('honours a different timezone when one is given', () => {
    expect(businessDate('2026-08-05T23:30:00.000Z', 'UTC')).toBe('2026-08-05');
  });

  it('throws on an unparseable instant rather than filing under NaN', () => {
    expect(() => businessDate('not a date')).toThrow(TypeError);
  });
});

describe('localTime', () => {
  it('reads as 24-hour Bangkok clock time', () => {
    expect(localTime('2026-08-05T04:30:00.000Z')).toBe('11:30');
  });
});

describe('minutesBetween', () => {
  it('floors to whole minutes', () => {
    expect(
      minutesBetween('2026-08-05T04:00:00.000Z', '2026-08-05T04:06:59.000Z'),
    ).toBe(6);
  });

  it('never goes negative when clocks disagree', () => {
    expect(
      minutesBetween('2026-08-05T04:10:00.000Z', '2026-08-05T04:00:00.000Z'),
    ).toBe(0);
  });
});
