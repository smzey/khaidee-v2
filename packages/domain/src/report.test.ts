import { describe, expect, it } from 'vitest';
import {
  buildReport,
  daysInRange,
  headlineNumbers,
  isReportWorthNarrating,
  type ReportableOrder,
} from './report.js';
import type { OrderLine, OrderStatus } from './types.js';

const TZ = 'Asia/Bangkok';

const line = (over: Partial<OrderLine> = {}): OrderLine => ({
  menuItemId: 'i1',
  qty: 1,
  unitPrice: 60,
  nameSnapshot: 'Pad Thai',
  options: [],
  ...over,
});

/** Bangkok is UTC+7, so 04:30Z is 11:30 local — inside the lunch rush. */
const at = (hourUtc: number, minute = 0) =>
  `2026-08-01T${String(hourUtc).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;

const order = (over: Partial<ReportableOrder> = {}): ReportableOrder => ({
  businessDate: '2026-08-01',
  status: 'completed' as OrderStatus,
  source: 'customer',
  total: 60,
  paymentMethod: 'cash',
  lines: [line()],
  placedAt: at(4, 30),
  readyAt: at(4, 36),
  completedAt: at(4, 38),
  ...over,
});

const build = (orders: ReportableOrder[], over: Partial<Parameters<typeof buildReport>[0]> = {}) =>
  buildReport({ orders, from: '2026-08-01', to: '2026-08-01', timeZone: TZ, ...over });

describe('takings', () => {
  it('counts only completed orders as money', () => {
    const facts = build([
      order({ total: 60 }),
      order({ total: 55, status: 'ready', completedAt: null }),
      order({ total: 40, status: 'cancelled', readyAt: null, completedAt: null }),
    ]);

    expect(facts.takings.gross).toBe(60);
    expect(facts.takings.orders).toBe(1);
  });

  it('reports unfinished money separately rather than hiding it', () => {
    const facts = build([
      order({ total: 60 }),
      order({ total: 55, status: 'ready', completedAt: null }),
      order({ total: 40, status: 'cancelled', readyAt: null, completedAt: null }),
    ]);

    expect(facts.unfinished).toEqual({
      open: 1,
      openBaht: 55,
      cancelled: 1,
      cancelledBaht: 40,
    });
  });

  it('averages to whole baht', () => {
    const facts = build([order({ total: 60 }), order({ total: 55 })]);
    expect(facts.takings.averageOrder).toBe(58);
  });

  it('does not divide by zero on a day with no sales', () => {
    const facts = build([]);
    expect(facts.takings).toEqual({
      gross: 0,
      orders: 0,
      averageOrder: 0,
      dishesSold: 0,
      distinctDishes: 0,
    });
    expect(facts.service.medianMinutesToReady).toBeNull();
    expect(facts.hours).toEqual([]);
  });
});

describe('dish ranking', () => {
  it('ranks by money taken, not by count', () => {
    const facts = build([
      order({
        total: 200,
        lines: [line({ menuItemId: 'crab', nameSnapshot: 'Crab omelette', unitPrice: 200 })],
      }),
      order({
        total: 120,
        lines: [line({ menuItemId: 'water', nameSnapshot: 'Water', unitPrice: 10, qty: 12 })],
      }),
    ]);

    expect(facts.dishes.map((dish) => dish.name)).toEqual(['Crab omelette', 'Water']);
    expect(facts.dishes[0]?.shareOfTakings).toBe(62.5);
  });

  it('prices options into the dish total', () => {
    const facts = build([
      order({
        total: 140,
        lines: [
          line({
            qty: 2,
            unitPrice: 60,
            options: [
              { optionId: 'egg', nameSnapshot: 'Fried egg', priceDelta: 10 },
            ],
          }),
        ],
      }),
    ]);

    expect(facts.dishes[0]?.baht).toBe(140);
    expect(facts.dishes[0]?.qty).toBe(2);
  });

  it('follows a rename, so the report reads as the menu does today', () => {
    const facts = build([
      order({ lines: [line({ nameSnapshot: 'Pad Thai' })], placedAt: at(3) }),
      order({ lines: [line({ nameSnapshot: 'Pad Thai (house)' })], placedAt: at(5) }),
    ]);

    expect(facts.dishes).toHaveLength(1);
    expect(facts.dishes[0]?.name).toBe('Pad Thai (house)');
  });
});

describe('options', () => {
  it('measures how often an option rides along', () => {
    const facts = build([
      order({
        lines: [
          line({ options: [{ optionId: 'egg', nameSnapshot: 'Fried egg', priceDelta: 10 }] }),
        ],
      }),
      order({ lines: [line()] }),
      order({ lines: [line()] }),
      order({ lines: [line()] }),
    ]);

    expect(facts.options[0]).toEqual({
      name: 'Fried egg',
      qty: 1,
      baht: 10,
      attachRate: 25,
    });
  });

  it('scales an option by the quantity it was sold with', () => {
    const facts = build([
      order({
        total: 210,
        lines: [
          line({
            qty: 3,
            options: [{ optionId: 'egg', nameSnapshot: 'Fried egg', priceDelta: 10 }],
          }),
        ],
      }),
    ]);

    expect(facts.options[0]?.qty).toBe(3);
    expect(facts.options[0]?.baht).toBe(30);
  });

  it('counts a free option without inventing revenue for it', () => {
    const facts = build([
      order({
        lines: [line({ options: [{ optionId: 'mild', nameSnapshot: 'Mild', priceDelta: 0 }] })],
      }),
    ]);

    expect(facts.options[0]?.baht).toBe(0);
    expect(facts.options[0]?.attachRate).toBe(100);
  });
});

describe('hours', () => {
  it('buckets by the stall clock, not the server clock', () => {
    // 04:30Z and 05:10Z are 11:30 and 12:10 in Bangkok — two different hours.
    const facts = build([
      order({ placedAt: at(4, 30), total: 60 }),
      order({ placedAt: at(5, 10), total: 90 }),
      order({ placedAt: at(5, 50), total: 30 }),
    ]);

    expect(facts.hours).toEqual([
      { hour: 11, orders: 1, baht: 60 },
      { hour: 12, orders: 2, baht: 120 },
    ]);
  });

  it('omits hours with no trade rather than padding twenty-four rows', () => {
    const facts = build([order({ placedAt: at(4, 30) })]);
    expect(facts.hours).toHaveLength(1);
  });
});

describe('service times', () => {
  it('measures the wait the customer actually had', () => {
    const facts = build([
      order({ placedAt: at(4, 0), readyAt: at(4, 6), completedAt: at(4, 8) }),
      order({ placedAt: at(4, 0), readyAt: at(4, 20), completedAt: at(4, 21) }),
      order({ placedAt: at(4, 0), readyAt: at(4, 10), completedAt: at(4, 30) }),
    ]);

    expect(facts.service.medianMinutesToReady).toBe(10);
    expect(facts.service.slowestMinutesToReady).toBe(20);
    expect(facts.service.medianMinutesToCollect).toBe(2);
    expect(facts.service.sampled).toBe(3);
  });

  it('averages the middle pair on an even sample', () => {
    const facts = build([
      order({ placedAt: at(4, 0), readyAt: at(4, 4) }),
      order({ placedAt: at(4, 0), readyAt: at(4, 9) }),
    ]);

    expect(facts.service.medianMinutesToReady).toBe(7);
  });

  it('skips orders that never had a ready time', () => {
    const facts = build([
      order({ placedAt: at(4, 0), readyAt: at(4, 6) }),
      order({ placedAt: at(4, 0), readyAt: null }),
    ]);

    expect(facts.service.sampled).toBe(1);
  });
});

describe('splits', () => {
  it('separates cash from PromptPay and flags what was never recorded', () => {
    const facts = build([
      order({ total: 60, paymentMethod: 'cash' }),
      order({ total: 90, paymentMethod: 'promptpay' }),
      order({ total: 30, paymentMethod: null }),
    ]);

    expect(facts.payment.cash).toEqual({ orders: 1, baht: 60 });
    expect(facts.payment.promptpay).toEqual({ orders: 1, baht: 90 });
    expect(facts.payment.unrecorded).toEqual({ orders: 1, baht: 30 });
  });

  it('separates QR orders from walk-ups the vendor rang up', () => {
    const facts = build([
      order({ total: 60, source: 'customer' }),
      order({ total: 90, source: 'vendor' }),
    ]);

    expect(facts.channel.customer).toEqual({ orders: 1, baht: 60 });
    expect(facts.channel.vendor).toEqual({ orders: 1, baht: 90 });
  });
});

describe('movement against the period before', () => {
  it('reports the change in both baht and percent', () => {
    const facts = build([order({ total: 120 }), order({ total: 80 })], {
      previous: [order({ total: 100 })],
    });

    expect(facts.movement).toEqual({
      previousGross: 100,
      previousOrders: 1,
      grossDelta: 100,
      grossPercent: 100,
      ordersDelta: 1,
    });
  });

  it('refuses to state a percent of nothing', () => {
    const facts = build([order({ total: 120 })], { previous: [] });
    expect(facts.movement?.grossPercent).toBeNull();
    expect(facts.movement?.grossDelta).toBe(120);
  });

  it('is null when no comparison was asked for', () => {
    expect(build([order()]).movement).toBeNull();
  });
});

describe('daysInRange', () => {
  it('counts inclusively', () => {
    expect(daysInRange('2026-08-01', '2026-08-01')).toBe(1);
    expect(daysInRange('2026-08-01', '2026-08-07')).toBe(7);
  });

  it('spans a month boundary', () => {
    expect(daysInRange('2026-07-30', '2026-08-02')).toBe(4);
  });
});

describe('deciding whether to spend a model call', () => {
  it('holds off on a near-empty day, where narrative would be invention', () => {
    expect(isReportWorthNarrating(build([order(), order()]))).toBe(false);
  });

  it('goes ahead once there is a real day to describe', () => {
    expect(isReportWorthNarrating(build([order(), order(), order()]))).toBe(true);
  });
});

describe('headlineNumbers', () => {
  it('picks the hour that took the most, not the one with most orders', () => {
    const facts = build([
      order({ placedAt: at(4, 0), total: 30 }),
      order({ placedAt: at(4, 10), total: 30 }),
      order({ placedAt: at(6, 0), total: 400 }),
    ]);

    expect(headlineNumbers(facts).peakHour).toBe(13);
    expect(headlineNumbers(facts).gross).toBe(460);
  });

  it('has no top dish on an empty day', () => {
    expect(headlineNumbers(build([])).topDish).toBeNull();
  });
});
