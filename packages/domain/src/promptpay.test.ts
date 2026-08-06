import { describe, expect, it } from 'vitest';
import {
  crc16,
  normalizeTarget,
  promptPayPayload,
  verifyPayload,
} from './promptpay.js';

/**
 * Walks the EMVCo tag-length-value structure so the tests can assert on real
 * fields rather than on substring accidents.
 */
function parse(payload: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < payload.length) {
    const id = payload.slice(i, i + 2);
    const length = Number(payload.slice(i + 2, i + 4));
    out[id] = payload.slice(i + 4, i + 4 + length);
    i += 4 + length;
  }
  return out;
}

describe('crc16 (CCITT-FALSE)', () => {
  it('matches the standard check value for "123456789"', () => {
    // 0x29B1 is the published check value for CRC-16/CCITT-FALSE. If this
    // fails, the algorithm is wrong, not the test.
    expect(crc16('123456789')).toBe(0x29b1);
  });

  it('is deterministic', () => {
    expect(crc16('khaidee')).toBe(crc16('khaidee'));
  });

  it('changes when the input changes', () => {
    expect(crc16('110.00')).not.toBe(crc16('120.00'));
  });

  it('stays inside 16 bits', () => {
    for (const input of ['', 'a', 'a longer payload string', '000000']) {
      expect(crc16(input)).toBeGreaterThanOrEqual(0);
      expect(crc16(input)).toBeLessThanOrEqual(0xffff);
    }
  });
});

describe('normalizeTarget', () => {
  it('turns a Thai mobile into payload form', () => {
    expect(normalizeTarget('0812345678')).toEqual({
      kind: 'mobile',
      value: '0066812345678',
    });
  });

  it('ignores the punctuation a vendor types', () => {
    expect(normalizeTarget('081-234-5678').value).toBe('0066812345678');
    expect(normalizeTarget('081 234 5678').value).toBe('0066812345678');
  });

  it('accepts a number already carrying the country code', () => {
    expect(normalizeTarget('+66812345678').value).toBe('0066812345678');
  });

  it('accepts a number already in payload form', () => {
    expect(normalizeTarget('0066812345678').value).toBe('0066812345678');
  });

  it('reads a 13-digit number as a national ID', () => {
    expect(normalizeTarget('1234567890123')).toEqual({
      kind: 'nationalId',
      value: '1234567890123',
    });
  });

  it('refuses something that is neither', () => {
    expect(() => normalizeTarget('12345')).toThrow(RangeError);
    expect(() => normalizeTarget('')).toThrow(RangeError);
  });
});

describe('promptPayPayload', () => {
  const payload = promptPayPayload('0812345678', 110);
  const fields = parse(payload);

  it('declares payload format 01', () => {
    expect(fields['00']).toBe('01');
  });

  it('marks itself dynamic, because the amount is baked in', () => {
    expect(fields['01']).toBe('12');
  });

  it('carries the PromptPay application id and the mobile number', () => {
    const merchant = parse(fields['29'] as string);
    expect(merchant['00']).toBe('A000000677010111');
    expect(merchant['01']).toBe('0066812345678');
  });

  it('uses tag 02 for a national ID instead of tag 01', () => {
    const merchant = parse(
      parse(promptPayPayload('1234567890123', 50))['29'] as string,
    );
    expect(merchant['02']).toBe('1234567890123');
    expect(merchant['01']).toBeUndefined();
  });

  it('prices in Thai baht', () => {
    expect(fields['53']).toBe('764');
    expect(fields['58']).toBe('TH');
  });

  it('writes the exact amount to two decimals', () => {
    expect(fields['54']).toBe('110.00');
    expect(parse(promptPayPayload('0812345678', 60))['54']).toBe('60.00');
    expect(parse(promptPayPayload('0812345678', 1234))['54']).toBe('1234.00');
  });

  it('ends with a four-character checksum that verifies', () => {
    expect(payload.slice(-8, -4)).toBe('6304');
    expect(verifyPayload(payload)).toBe(true);
  });

  it('every field length matches its value', () => {
    // parse() would desynchronise and produce junk ids if any length were
    // wrong, so a clean parse of only known tags is the real assertion.
    expect(Object.keys(fields).sort()).toEqual([
      '00',
      '01',
      '29',
      '53',
      '54',
      '58',
      '63',
    ]);
  });

  it('uses the field order Thai banking apps expect', () => {
    expect(payload).toMatch(/^00020101021229/);
    expect(payload.indexOf('5802TH')).toBeLessThan(payload.indexOf('5303764'));
    expect(payload.indexOf('5303764')).toBeLessThan(payload.indexOf('5406110.00'));
  });

  it('produces a different checksum for a different amount', () => {
    const a = promptPayPayload('0812345678', 110);
    const b = promptPayPayload('0812345678', 111);
    expect(a.slice(-4)).not.toBe(b.slice(-4));
  });

  it('refuses a negative amount', () => {
    expect(() => promptPayPayload('0812345678', -1)).toThrow(RangeError);
  });
});

describe('verifyPayload', () => {
  it('rejects a payload whose amount was edited in flight', () => {
    const payload = promptPayPayload('0812345678', 110);
    const tampered = payload.replace('110.00', '010.00');
    expect(verifyPayload(tampered)).toBe(false);
  });

  it('rejects junk', () => {
    expect(verifyPayload('')).toBe(false);
    expect(verifyPayload('not a payload')).toBe(false);
  });
});
