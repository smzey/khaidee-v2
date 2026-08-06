import type { Category, MenuItem, OrderDto } from '@khaidee/domain';

function inferApiUrl(): string {
  const configured = import.meta.env.VITE_API_URL;

  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location;
    if (hostname.endsWith('ngrok-free.app') && configured) {
      return configured;
    }
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return `${protocol}//${hostname}:3000`;
    }
    if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
      return `${protocol}//${hostname}:3000`;
    }
  }

  return configured ?? 'http://localhost:3000';
}

export const API_URL = inferApiUrl();

export interface Storefront {
  vendor: { id: string; slug: string; name: string; isOpen: boolean };
  categories: Category[];
  menu: MenuItem[];
}

/** Dish photos come back as API-relative paths, not absolute URLs. */
export const absoluteUrl = (path: string): string => {
  const value = path.startsWith('/') ? `${API_URL}${path}` : path;
  const url = new URL(value);
  if (url.hostname.endsWith('ngrok-free.app')) {
    url.searchParams.set('ngrok-skip-browser-warning', 'true');
  }
  return url.toString();
};

const ngrokHeaders = (): Record<string, string> =>
  API_URL.includes('ngrok-free.app') ? { 'ngrok-skip-browser-warning': 'true' } : {};

export interface Payment {
  total: number;
  promptpayPayload: string | null;
  promptpayQrDataUrl: string | null;
}

/**
 * Errors the API names on purpose, so a screen can say something true rather
 * than "something went wrong".
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: { items?: Array<{ id: string; name: string }> },
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...ngrokHeaders(), ...init?.headers },
    });
  } catch {
    throw new ApiError(0, 'offline', 'No connection. Check your signal.');
  }

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.code ?? 'unknown',
      body?.message ?? 'Something went wrong',
      body?.details,
    );
  }

  return body as T;
}

export const getStorefront = (slug: string) =>
  request<Storefront>(`/s/${encodeURIComponent(slug)}`);

export const placeOrder = (
  slug: string,
  lines: Array<{ itemId: string; qty: number; optionIds: string[] }>,
  clientId: string,
) =>
  request<OrderDto>(`/s/${encodeURIComponent(slug)}/orders`, {
    method: 'POST',
    body: JSON.stringify({ lines, clientId }),
  });

export const getOrder = (id: string) => request<OrderDto>(`/orders/${id}`);

export const getPayment = (id: string) =>
  request<Payment>(`/orders/${id}/payment`);

export const cancelOrder = (id: string, clientId: string) =>
  request<OrderDto>(`/orders/${id}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ clientId }),
  });

export const streamUrl = (id: string) => {
  const url = new URL(`${API_URL}/orders/${id}/stream`);
  if (API_URL.includes('ngrok-free.app')) {
    url.searchParams.set('ngrok-skip-browser-warning', 'true');
  }
  return url.toString();
};
