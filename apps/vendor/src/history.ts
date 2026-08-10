import { type OrderDto, businessDate } from '@khaidee/domain';

export type HistoryFilter =
  | 'all'
  | 'completed'
  | 'cancelled'
  | 'cash'
  | 'promptpay'
  | 'customer'
  | 'ring-up';

export interface HistoryRange {
  from: string;
  to: string;
  label: string;
}

export interface HistorySummary {
  salesTotal: number;
  completed: number;
  cancelled: number;
  averageOrder: number;
  cashTotal: number;
  promptpayTotal: number;
}

export function todayRange(now = new Date()): HistoryRange {
  const day = businessDate(now);
  return { from: day, to: day, label: 'Today' };
}

export function shiftDate(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

export function presetRange(
  preset: 'today' | 'yesterday' | '7d' | '30d',
  now = new Date(),
): HistoryRange {
  const today = businessDate(now);
  if (preset === 'today') return { from: today, to: today, label: 'Today' };
  if (preset === 'yesterday') {
    const yesterday = shiftDate(today, -1);
    return { from: yesterday, to: yesterday, label: 'Yesterday' };
  }
  if (preset === '7d') {
    return { from: shiftDate(today, -6), to: today, label: '7 days' };
  }
  return { from: shiftDate(today, -29), to: today, label: '30 days' };
}

export function historySummary(orders: readonly OrderDto[]): HistorySummary {
  const completed = orders.filter((order) => order.status === 'completed');
  const salesTotal = completed.reduce((sum, order) => sum + order.total, 0);
  const cashTotal = completed
    .filter((order) => order.paymentMethod === 'cash')
    .reduce((sum, order) => sum + order.total, 0);
  const promptpayTotal = completed
    .filter((order) => order.paymentMethod === 'promptpay')
    .reduce((sum, order) => sum + order.total, 0);

  return {
    salesTotal,
    completed: completed.length,
    cancelled: orders.filter((order) => order.status === 'cancelled').length,
    averageOrder:
      completed.length === 0 ? 0 : Math.round(salesTotal / completed.length),
    cashTotal,
    promptpayTotal,
  };
}

function matchesFilter(order: OrderDto, filter: HistoryFilter): boolean {
  switch (filter) {
    case 'completed':
      return order.status === 'completed';
    case 'cancelled':
      return order.status === 'cancelled';
    case 'cash':
      return order.paymentMethod === 'cash';
    case 'promptpay':
      return order.paymentMethod === 'promptpay';
    case 'customer':
      return order.source === 'customer';
    case 'ring-up':
      return order.source === 'vendor';
    case 'all':
      return true;
  }
}

function searchable(order: OrderDto): string {
  return [
    `#${order.queueNo}`,
    String(order.queueNo),
    order.businessDate,
    order.status,
    order.source === 'vendor' ? 'ring-up counter vendor' : 'customer qr',
    order.paymentMethod ?? '',
    ...order.lines.flatMap((line) => [
      line.nameSnapshot,
      ...line.options.map((option) => option.nameSnapshot),
    ]),
  ]
    .join(' ')
    .toLowerCase();
}

export function filterHistoryOrders(
  orders: readonly OrderDto[],
  params: { search: string; filter: HistoryFilter },
): OrderDto[] {
  const needle = params.search.trim().toLowerCase();
  return orders.filter(
    (order) =>
      matchesFilter(order, params.filter) &&
      (!needle || searchable(order).includes(needle)),
  );
}

export function activeHistorySettingsCount(params: {
  range: HistoryRange;
  filter: HistoryFilter;
}): number {
  return (params.range.label === 'Today' ? 0 : 1) + (params.filter === 'all' ? 0 : 1);
}
