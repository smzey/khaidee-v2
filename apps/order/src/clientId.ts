const LEGACY_KEY = 'khaidee.clientId';
const ORDER_KEY = 'khaidee.order';
const ORDER_CLIENT_KEY = 'khaidee.orderClientId';
const STALL_KEY = 'khaidee.stallSlug';

function uuidV4(): string {
  const bytes = new Uint8Array(16);
  const webCrypto = globalThis.crypto;

  if (webCrypto?.getRandomValues) {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}

/** One id per order attempt. Reusing it after cancel would resurrect the old ticket. */
export function clientId(): string {
  return globalThis.crypto?.randomUUID?.() ?? uuidV4();
}

/** Remembers the order in flight, so closing the tab does not lose the ticket. */
export function rememberOrder(id: string, orderClientId: string): void {
  try {
    localStorage.setItem(ORDER_KEY, id);
    localStorage.setItem(ORDER_CLIENT_KEY, orderClientId);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* nothing to do */
  }
}

export function lastOrder(): string | null {
  try {
    return localStorage.getItem(ORDER_KEY);
  } catch {
    return null;
  }
}

export function rememberStall(slug: string): void {
  try {
    localStorage.setItem(STALL_KEY, slug);
  } catch {
    /* nothing to do */
  }
}

export function lastStall(): string | null {
  try {
    return localStorage.getItem(STALL_KEY);
  } catch {
    return null;
  }
}

export function rememberedClientId(): string | null {
  try {
    return localStorage.getItem(ORDER_CLIENT_KEY) ?? localStorage.getItem(LEGACY_KEY);
  } catch {
    return null;
  }
}

export function forgetOrder(): void {
  try {
    localStorage.removeItem(ORDER_KEY);
    localStorage.removeItem(ORDER_CLIENT_KEY);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* nothing to do */
  }
}
