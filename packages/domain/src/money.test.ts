import { describe, expect, it } from 'vitest';
import { sumLines } from './cart.js';
import { formatBaht, formatDelta } from './money.js';
import type { OrderLine } from './types.js';

const line = (qty: number, unitPrice: number): OrderLine => ({
  menuItemId: 'a',
  qty,
  unitPrice,
  nameSnapshot: 'Pad Thai',
  options: [],
});

describe('formatBaht', () => {
  it('prefixes the baht sign', () => {
    expect(formatBaht(60)).toBe('฿60');
  });

  it('groups thousands', () => {
    expect(formatBaht(1234)).toBe('฿1,234');
    expect(formatBaht(1234567)).toBe('฿1,234,567');
  });

  it('does not group three digits', () => {
    expect(formatBaht(999)).toBe('฿999');
  });

  it('handles zero', () => {
    expect(formatBaht(0)).toBe('฿0');
  });

  it('puts the sign before the symbol for negatives', () => {
    expect(formatBaht(-1234)).toBe('-฿1,234');
  });

  it('rounds rather than printing a fraction of a baht', () => {
    expect(formatBaht(60.4)).toBe('฿60');
    expect(formatBaht(60.5)).toBe('฿61');
  });
});

describe('formatDelta', () => {
  it('says nothing when an option is free', () => {
    expect(formatDelta(0)).toBe('');
  });

  it('signs a surcharge', () => {
    expect(formatDelta(10)).toBe('+฿10');
  });

  it('signs a discount', () => {
    expect(formatDelta(-5)).toBe('−฿5');
  });
});

describe('sumLines', () => {
  it('multiplies quantity by unit price', () => {
    expect(sumLines([line(1, 60), line(2, 25)])).toBe(110);
  });

  it('is zero for no lines', () => {
    expect(sumLines([])).toBe(0);
  });
});
