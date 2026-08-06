import type {
  Category,
  MenuItem,
  OrderDto,
  PaymentMethod,
  ReportBrief,
  ReportFacts,
} from '@khaidee/domain';
import Constants from 'expo-constants';
import type { Feature, Tier, TierPlan } from '@khaidee/domain';
import type { Stall } from './session';

function readDevHost(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const hostUri = (value as { hostUri?: unknown }).hostUri;
  const debuggerHost = (value as { debuggerHost?: unknown }).debuggerHost;
  const candidate = typeof hostUri === 'string'
    ? hostUri
    : typeof debuggerHost === 'string'
      ? debuggerHost
      : null;
  return candidate?.split(':')[0] ?? null;
}

/**
 * The stall phone is not the machine running the API, so `localhost` is wrong
 * on a device. In development Expo knows the address the bundler was reached
 * on, which is the same machine — so the API URL is derived from it rather
 * than typed in and forgotten.
 */
function inferApiUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured) return configured;

  const host =
    readDevHost(Constants.expoConfig) ??
    readDevHost(Constants.expoGoConfig) ??
    readDevHost(Constants.manifest);
  if (host) return `http://${host}:3000`;

  return 'http://localhost:3000';
}

export const API_URL = inferApiUrl();

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Whatever the API attached — the upgrade price, the sold-out items. */
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** A signed-out token is not an error to log; it is a screen to show. */
export const isSignedOut = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 401;

async function request<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, ...rest } = init;

  /*
   * Only declare a JSON content-type when there is actually JSON to send.
   * Accept, ready and cancel post nothing, and Fastify rejects an empty body
   * that claims to be JSON — which cost an evening to find, because curl
   * omits the header and so never reproduced it.
   */
  const headers: Record<string, string> = {
    ...(rest.body ? { 'content-type': 'application/json' } : {}),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(API_URL.includes('ngrok-free.app') ? { 'ngrok-skip-browser-warning': 'true' } : {}),
    ...(rest.headers as Record<string, string> | undefined),
  };

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...rest, headers });
  } catch {
    throw new ApiError(0, 'offline', 'No connection to the stall');
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

async function multipartRequest<T>(
  path: string,
  token: string,
  body: FormData,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        ...(API_URL.includes('ngrok-free.app') ? { 'ngrok-skip-browser-warning': 'true' } : {}),
      },
      body,
    });
  } catch {
    throw new ApiError(0, 'offline', 'No connection to the stall');
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.code ?? 'unknown',
      payload?.message ?? 'Something went wrong',
    );
  }

  return payload as T;
}

export const signIn = (slug: string, pin: string) =>
  request<{ token: string; vendor: Stall }>(
    '/vendor/session',
    { method: 'POST', body: JSON.stringify({ slug, pin }) },
  );

export const registerVendor = (body: {
  name: string;
  slug: string;
  pin: string;
  promptpayId?: string;
}) =>
  request<{
    token: string;
    vendor: Stall;
    orderUrl: string;
  }>('/vendor/register', { method: 'POST', body: JSON.stringify(body) });

export const addCategory = (
  token: string,
  body: { nameTh: string; nameEn: string; sortOrder?: number },
) =>
  request<Category>('/vendor/categories', {
    method: 'POST',
    token,
    body: JSON.stringify(body),
  });

export const updateCategory = (
  token: string,
  id: string,
  body: { nameTh?: string; nameEn?: string; sortOrder?: number },
) =>
  request<Category>(`/vendor/categories/${id}`, {
    method: 'PATCH',
    token,
    body: JSON.stringify(body),
  });

export const deleteCategory = (token: string, id: string) =>
  request<{ id: string }>(`/vendor/categories/${id}`, {
    method: 'DELETE',
    token,
  });

export const addMenuItem = (
  token: string,
  body: {
    categoryId?: string | null;
    nameTh: string;
    nameEn: string;
    price: number;
    ingredients?: Array<{ name: string; qty: number; unit: string }>;
    sortOrder?: number;
  },
) =>
  request<MenuItem>('/vendor/menu', {
    method: 'POST',
    token,
    body: JSON.stringify(body),
  });

export const updateMenuItem = (
  token: string,
  id: string,
  body: {
    categoryId?: string | null;
    nameTh?: string;
    nameEn?: string;
    price?: number;
    ingredients?: Array<{ name: string; qty: number; unit: string }>;
    sortOrder?: number;
  },
) =>
  request<MenuItem>(`/vendor/menu/${id}`, {
    method: 'PATCH',
    token,
    body: JSON.stringify(body),
  });

export const deleteMenuItem = (token: string, id: string) =>
  request<{ id: string }>(`/vendor/menu/${id}`, {
    method: 'DELETE',
    token,
  });

export const addOptionGroup = (
  token: string,
  menuItemId: string,
  body: {
    nameTh: string;
    nameEn: string;
    minSelect: number;
    maxSelect: number;
    sortOrder?: number;
    options: Array<{ nameTh: string; nameEn: string; priceDelta?: number }>;
  },
) =>
  request(`/vendor/menu/${menuItemId}/option-groups`, {
    method: 'POST',
    token,
    body: JSON.stringify(body),
  });

export const fetchCategories = (token: string) =>
  request<Category[]>('/vendor/categories', { token });

export const fetchMenu = (token: string) =>
  request<MenuItem[]>('/vendor/menu', { token });

export const setMenuItemAvailability = (
  token: string,
  id: string,
  isAvailable: boolean,
) =>
  request<MenuItem>(`/vendor/menu/${id}/availability`, {
    method: 'POST',
    token,
    body: JSON.stringify({ isAvailable }),
  });

export const uploadMenuItemImage = (
  token: string,
  id: string,
  image: { uri: string; name: string; type: string },
) => {
  const form = new FormData();
  form.append('file', image as unknown as Blob);
  return multipartRequest<{ imageUrl: string; bytes: number }>(
    `/vendor/menu/${id}/image`,
    token,
    form,
  );
};

export const deleteMenuItemImage = (token: string, id: string) =>
  request<{ imageUrl: null }>(`/vendor/menu/${id}/image`, {
    method: 'DELETE',
    token,
  });

export const fetchToday = (token: string) =>
  request<OrderDto[]>('/vendor/orders', { token });

export const ringUpOrder = (
  token: string,
  body: {
    clientId: string;
    lines: Array<{ itemId: string; qty: number; optionIds?: string[] }>;
    paymentMethod: PaymentMethod;
  },
) =>
  request<OrderDto>('/vendor/orders', {
    method: 'POST',
    token,
    body: JSON.stringify(body),
  });

export const setStallOpen = (token: string, isOpen: boolean) =>
  request<Stall>('/vendor/open', {
    method: 'POST',
    token,
    body: JSON.stringify({ isOpen }),
  });

export const updateStall = (
  token: string,
  body: { name?: string; promptpayId?: string | null; pin?: string },
) =>
  request<Stall>('/vendor/stall', {
    method: 'PATCH',
    token,
    body: JSON.stringify(body),
  });

export const registerPushToken = (
  token: string,
  body: { token: string; platform: 'ios' | 'android' | null },
) =>
  request<{ id: string; token: string; platform: string | null }>(
    '/vendor/push-token',
    {
      method: 'POST',
      token,
      body: JSON.stringify(body),
    },
  );

export const fetchRingUpPromptPayQr = (token: string, amount: number) =>
  request<{
    total: number;
    promptpayPayload: string | null;
    promptpayQrDataUrl: string | null;
  }>('/vendor/promptpay-qr', {
    method: 'POST',
    token,
    body: JSON.stringify({ amount }),
  });

export interface TomorrowForecast {
  targetDate: string;
  history: {
    from: string;
    to: string;
    daysWithSales: number;
    completedOrders: number;
    averageRevenue: number;
    projectedRevenue: number;
    demandMultiplier: number;
  };
  weather: {
    source: 'open-meteo';
    location: string;
    date: string;
    tempMaxC: number | null;
    tempMinC: number | null;
    precipitationProbability: number | null;
    precipitationMm: number | null;
    weatherCode: number | null;
    summary: string;
  } | null;
  ingredients: Array<{
    key: string;
    name: string;
    unit: string;
    averageQty: number;
    forecastQty: number;
    dishes: string[];
  }>;
  dishes: Array<{
    menuItemId: string;
    name: string;
    averageQty: number;
    forecastQty: number;
    averageRevenue: number;
    hasIngredients: boolean;
  }>;
  missingRecipeDishes: string[];
  notes: string[];
}

export const fetchTomorrowForecast = (token: string) =>
  request<TomorrowForecast>('/vendor/forecast/tomorrow', { token });

export interface VendorReport {
  vendor: { id: string; name: string; timeZone: string };
  range: { from: string; to: string };
  facts: ReportFacts;
}

export interface WrittenVendorReport extends VendorReport {
  brief: ReportBrief | null;
  skipped: 'not_enough_trade' | null;
  model: string | null;
  cached: boolean;
  usage: { inputTokens: number; outputTokens: number } | null;
}

export const fetchReport = (token: string) =>
  request<VendorReport>('/vendor/report', { token });

export const writeReportBrief = (
  token: string,
  language: 'th' | 'en',
) =>
  request<WrittenVendorReport>('/vendor/report/brief', {
    method: 'POST',
    token,
    body: JSON.stringify({ language }),
  });

export const fetchQrCard = (token: string) =>
  request<{
    vendor: { id: string; slug: string; name: string };
    orderUrl: string;
    qrDataUrl: string;
    exportDataUrl: string;
    variants: {
      public: {
        label: string;
        orderUrl: string;
        qrDataUrl: string;
        exportDataUrl: string;
      };
      lan: {
        label: string;
        orderUrl: string;
        qrDataUrl: string;
        exportDataUrl: string;
      };
    };
  }>('/vendor/qr/card', { token });

export const acceptOrder = (token: string, id: string) =>
  request<OrderDto>(`/vendor/orders/${id}/accept`, { method: 'POST', token });

export const readyOrder = (token: string, id: string) =>
  request<OrderDto>(`/vendor/orders/${id}/ready`, { method: 'POST', token });

export const completeOrder = (
  token: string,
  id: string,
  paymentMethod: PaymentMethod,
) =>
  request<OrderDto>(`/vendor/orders/${id}/complete`, {
    method: 'POST',
    token,
    body: JSON.stringify({ paymentMethod }),
  });

export const cancelOrder = (token: string, id: string) =>
  request<OrderDto>(`/vendor/orders/${id}/cancel`, { method: 'POST', token });

export const streamUrl = (lastEventId: number) =>
  `${API_URL}/vendor/stream?lastEventId=${lastEventId}`;

export interface AssistantTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantAnswer {
  reply: string;
  toolCalls: Array<{ name: string; input: unknown }>;
  model: string;
  stall: string;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * One question to the assistant. The thread lives on this phone and is sent
 * back each time — the server keeps no conversation, because a chat about
 * today's takings is worth nothing tomorrow.
 */
export const askAssistant = (
  token: string,
  question: string,
  history: AssistantTurn[],
) =>
  request<AssistantAnswer>('/vendor/assistant', {
    method: 'POST',
    token,
    body: JSON.stringify({ question, history }),
  });

export interface PlansResponse {
  current: Tier;
  plans: TierPlan[];
  features: Record<Feature, Tier>;
}

/**
 * Plans come from the server rather than the bundle, so a price change reaches
 * a vendor's phone without waiting on an app-store release.
 */
export const fetchPlans = (token: string) =>
  request<PlansResponse>('/vendor/plans', { token });

/** A 402 carries the price of what was refused, so the app can say it. */
export interface UpgradeNeeded {
  feature: Feature;
  currentTier: Tier;
  requiredTier: Tier;
  price: number;
}

export const upgradeNeeded = (error: unknown): UpgradeNeeded | null =>
  error instanceof ApiError && error.status === 402 && error.details
    ? (error.details as UpgradeNeeded)
    : null;
