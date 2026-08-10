import type { OrderDto } from '@khaidee/domain';
import {
  activeHistorySettingsCount,
  filterHistoryOrders,
  historySummary,
  todayRange,
} from './history';

const order = (over: Partial<OrderDto> & { id: string; queueNo: number }): OrderDto => ({
  vendorId: 'v1',
  vendorName: 'Test Stall',
  businessDate: '2026-08-10',
  status: 'completed',
  source: 'customer',
  total: 60,
  paymentMethod: 'cash',
  lines: [
    {
      menuItemId: 'pad-thai',
      qty: 1,
      unitPrice: 60,
      nameSnapshot: 'Pad Thai',
      options: [{ optionId: 'mild', nameSnapshot: 'Mild', priceDelta: 0 }],
    },
  ],
  placedAt: '2026-08-10T04:00:00.000Z',
  acceptedAt: '2026-08-10T04:01:00.000Z',
  readyAt: '2026-08-10T04:05:00.000Z',
  completedAt: '2026-08-10T04:07:00.000Z',
  ...over,
});

describe('historySummary', () => {
  it('summarizes completed money, payment split and cancellations', () => {
    const summary = historySummary([
      order({ id: 'a', queueNo: 1, total: 100, paymentMethod: 'cash' }),
      order({ id: 'b', queueNo: 2, total: 80, paymentMethod: 'promptpay' }),
      order({ id: 'c', queueNo: 3, status: 'cancelled', total: 50, paymentMethod: null }),
    ]);

    expect(summary).toEqual({
      salesTotal: 180,
      completed: 2,
      cancelled: 1,
      averageOrder: 90,
      cashTotal: 100,
      promptpayTotal: 80,
    });
  });
});

describe('filterHistoryOrders', () => {
  const orders = [
    order({ id: 'a', queueNo: 12, total: 100, paymentMethod: 'cash' }),
    order({
      id: 'b',
      queueNo: 13,
      source: 'vendor',
      paymentMethod: 'promptpay',
      lines: [
        {
          menuItemId: 'tea',
          qty: 2,
          unitPrice: 25,
          nameSnapshot: 'Thai Tea',
          options: [],
        },
      ],
    }),
    order({ id: 'c', queueNo: 14, status: 'cancelled', paymentMethod: null }),
  ];

  it('searches queue numbers, dish names and options', () => {
    expect(filterHistoryOrders(orders, { search: '#12', filter: 'all' }).map((o) => o.id))
      .toEqual(['a']);
    expect(filterHistoryOrders(orders, { search: 'thai tea', filter: 'all' }).map((o) => o.id))
      .toEqual(['b']);
    expect(filterHistoryOrders(orders, { search: 'mild', filter: 'all' }).map((o) => o.id))
      .toEqual(['a', 'c']);
  });

  it('filters by status, payment and source', () => {
    expect(filterHistoryOrders(orders, { search: '', filter: 'cancelled' }).map((o) => o.id))
      .toEqual(['c']);
    expect(filterHistoryOrders(orders, { search: '', filter: 'promptpay' }).map((o) => o.id))
      .toEqual(['b']);
    expect(filterHistoryOrders(orders, { search: '', filter: 'ring-up' }).map((o) => o.id))
      .toEqual(['b']);
  });
});

describe('todayRange', () => {
  it('formats local dates for the API range query', () => {
    expect(todayRange(new Date('2026-08-10T06:00:00.000Z'))).toEqual({
      from: '2026-08-10',
      to: '2026-08-10',
      label: 'Today',
    });
  });
});

describe('activeHistorySettingsCount', () => {
  it('counts only settings hidden behind the filter button', () => {
    const today = { from: '2026-08-10', to: '2026-08-10', label: 'Today' };

    expect(activeHistorySettingsCount({ range: today, filter: 'all' })).toBe(0);
    expect(
      activeHistorySettingsCount({
        range: { from: '2026-08-04', to: '2026-08-10', label: '7 days' },
        filter: 'all',
      }),
    ).toBe(1);
    expect(
      activeHistorySettingsCount({
        range: { from: '2026-08-04', to: '2026-08-10', label: '7 days' },
        filter: 'cash',
      }),
    ).toBe(2);
  });
});
