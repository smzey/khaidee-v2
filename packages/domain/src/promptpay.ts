/**
 * PromptPay QR payloads, per the EMVCo merchant-presented QR spec that Thai
 * banking apps read.
 *
 * The customer's phone cannot take a payment, so the collect screen shows one
 * of these instead: the exact amount, into the vendor's own account, scannable
 * from any Thai banking app. No gateway, no merchant onboarding, no settlement
 * — the money moves bank to bank exactly as it does today, and the vendor
 * still confirms the slip before tapping complete.
 *
 * This builds the payload STRING. Turning it into a QR image is the client's
 * job.
 */

/** Every field is a two-digit id, a two-digit length, then the value. */
function field(id: string, value: string): string {
  const length = String(value.length).padStart(2, '0');
  if (value.length > 99) {
    throw new RangeError(`Field ${id} is too long for a two-digit length`);
  }
  return `${id}${length}${value}`;
}

/**
 * CRC-16/CCITT-FALSE: polynomial 0x1021, initial value 0xFFFF, no reflection,
 * no final xor. The spec's choice, not ours.
 */
export function crc16(input: string): number {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i += 1) {
    crc ^= input.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1) & 0xffff;
    }
  }
  return crc;
}

export type PromptPayTargetKind = 'mobile' | 'nationalId';

export interface PromptPayTarget {
  kind: PromptPayTargetKind;
  /** As it goes into the payload: 0066xxxxxxxxx, or 13 ID digits. */
  value: string;
}

/**
 * A vendor writes their PromptPay target however they like — 081-234-5678,
 * 0812345678, +66812345678. All of them mean the same account.
 */
export function normalizeTarget(raw: string): PromptPayTarget {
  const digits = raw.replace(/\D/g, '');

  // A 13-digit number is a national ID or tax ID, not a phone.
  if (digits.length === 13 && !digits.startsWith('0066')) {
    return { kind: 'nationalId', value: digits };
  }

  // 0812345678 -> 0066812345678
  if (digits.length === 10 && digits.startsWith('0')) {
    return { kind: 'mobile', value: `0066${digits.slice(1)}` };
  }

  // 66812345678 (already country-coded)
  if (digits.length === 11 && digits.startsWith('66')) {
    return { kind: 'mobile', value: `00${digits}` };
  }

  // 0066812345678 (already in payload form)
  if (digits.length === 13 && digits.startsWith('0066')) {
    return { kind: 'mobile', value: digits };
  }

  throw new RangeError(
    `Not a PromptPay mobile number or national ID: ${raw}`,
  );
}

const AID = 'A000000677010111';
const CURRENCY_THB = '764';
const COUNTRY_TH = 'TH';

/**
 * A payload for one specific order. Point-of-initiation is "12" (dynamic)
 * rather than "11" (static) because the amount is baked in — the customer
 * cannot mistype it, and the vendor is not reading numbers off a phone in
 * the dark.
 */
export function promptPayPayload(
  rawTarget: string,
  amountBaht: number,
): string {
  if (!Number.isFinite(amountBaht) || amountBaht < 0) {
    throw new RangeError(`Not a payable amount: ${amountBaht}`);
  }

  const target = normalizeTarget(rawTarget);
  const merchant =
    field('00', AID) +
    field(target.kind === 'mobile' ? '01' : '02', target.value);

  const body =
    field('00', '01') +
    field('01', '12') +
    field('29', merchant) +
    field('58', COUNTRY_TH) +
    field('53', CURRENCY_THB) +
    field('54', amountBaht.toFixed(2));

  // The CRC covers its own id and length, so append them before computing.
  const withCrcHeader = `${body}6304`;
  const checksum = crc16(withCrcHeader)
    .toString(16)
    .toUpperCase()
    .padStart(4, '0');

  return `${withCrcHeader}${checksum}`;
}

/** True if a payload's trailing checksum matches its contents. */
export function verifyPayload(payload: string): boolean {
  if (payload.length < 8) return false;
  const body = payload.slice(0, -4);
  const checksum = payload.slice(-4).toUpperCase();
  if (!body.endsWith('6304')) return false;
  return (
    crc16(body).toString(16).toUpperCase().padStart(4, '0') === checksum
  );
}
