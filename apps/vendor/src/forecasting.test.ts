import type { MenuItem, OrderDto } from '@khaidee/domain';
import { buildForecast, formatForecastQty } from './forecasting';

const item = (over: Partial<MenuItem> & { id: string; nameEn: string }): MenuItem => ({
  vendorId: 'v1',
  categoryId: null,
  nameTh: over.nameEn,
  price: 60,
  imageUrl: null,
  isAvailable: true,
  sortOrder: 0,
  optionGroups: [],
  ...over,
});

const order = (over: Partial<OrderDto> & { id: string; status: OrderDto['status'] }): OrderDto => ({
  vendorId: 'v1',
  vendorName: 'Test Stall',
  businessDate: '2026-08-06',
  queueNo: 1,
  source: 'customer',
  total: 60,
  paymentMethod: null,
  lines: [],
  placedAt: '2026-08-06T04:00:00.000Z',
  acceptedAt: null,
  readyAt: null,
  completedAt: null,
  ...over,
});

describe('buildForecast', () => {
  it('separates open queue demand from completed usage', () => {
    const menu = [
      item({
        id: 'pad-thai',
        nameEn: 'Pad Thai',
        ingredients: [{ name: 'Rice noodles', qty: 120, unit: 'g' }],
      }),
    ];

    const forecast = buildForecast(menu, [
      order({
        id: 'open',
        status: 'accepted',
        lines: [{ menuItemId: 'pad-thai', qty: 2, unitPrice: 60, nameSnapshot: 'Pad Thai', options: [] }],
      }),
      order({
        id: 'done',
        status: 'completed',
        lines: [{ menuItemId: 'pad-thai', qty: 1, unitPrice: 60, nameSnapshot: 'Pad Thai', options: [] }],
      }),
    ]);

    expect(forecast.ingredients).toEqual([
      {
        key: 'rice noodles|g',
        name: 'Rice noodles',
        unit: 'g',
        openQty: 240,
        usedQty: 120,
        totalQty: 360,
        dishes: ['Pad Thai'],
      },
    ]);
  });

  it('ignores cancelled orders and flags dishes without recipes', () => {
    const menu = [item({ id: 'water', nameEn: 'Water', ingredients: [] })];
    const forecast = buildForecast(menu, [
      order({
        id: 'cancelled',
        status: 'cancelled',
        lines: [{ menuItemId: 'water', qty: 9, unitPrice: 10, nameSnapshot: 'Water', options: [] }],
      }),
      order({
        id: 'open',
        status: 'placed',
        lines: [{ menuItemId: 'water', qty: 2, unitPrice: 10, nameSnapshot: 'Water', options: [] }],
      }),
    ]);

    expect(forecast.ingredients).toEqual([]);
    expect(forecast.missingRecipeDishes.map((dish) => dish.name)).toEqual(['Water']);
  });
});

describe('formatForecastQty', () => {
  it('keeps decimals readable', () => {
    expect(formatForecastQty(1.5, 'kg')).toBe('1.5 kg');
    expect(formatForecastQty(2, '')).toBe('2');
  });
});
