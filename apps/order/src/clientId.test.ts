import { describe, expect, it, vi } from 'vitest';
import {
  clientId,
  forgetOrder,
  lastStall,
  rememberOrder,
  rememberStall,
  rememberedClientId,
} from './clientId.js';

describe('clientId', () => {
  it('does not need crypto.randomUUID on older phone browsers', () => {
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', {
      getRandomValues(bytes: Uint8Array) {
        bytes.fill(7);
        return bytes;
      },
    });

    localStorage.clear();
    const id = clientId();

    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    vi.stubGlobal('crypto', originalCrypto);
  });

  it('creates a fresh id for each new order attempt', () => {
    const randomUUID = vi
      .fn()
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222');
    vi.stubGlobal('crypto', { randomUUID });

    expect(clientId()).toBe('11111111-1111-4111-8111-111111111111');
    expect(clientId()).toBe('22222222-2222-4222-8222-222222222222');
  });

  it('remembers the id used by the current order for cancellation', () => {
    localStorage.clear();

    rememberOrder('o1', 'order-key-1');
    expect(rememberedClientId()).toBe('order-key-1');

    forgetOrder();
    expect(rememberedClientId()).toBeNull();
  });

  it('remembers the last scanned stall separately from the active order', () => {
    localStorage.clear();

    rememberStall('somchai');
    rememberOrder('o1', 'order-key-1');
    forgetOrder();

    expect(lastStall()).toBe('somchai');
  });
});
