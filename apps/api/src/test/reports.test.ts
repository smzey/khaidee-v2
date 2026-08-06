import { businessDate } from '@khaidee/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type Harness,
  type StubNarrator,
  auth,
  createHarness,
  stubNarrator,
  uuid,
} from './harness.js';

let harness: Harness;
let narrator: StubNarrator;

beforeAll(async () => {
  narrator = stubNarrator();
  harness = await createHarness({ narrator });
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
  narrator.calls = [];
  narrator.failWith = null;
});

const today = () => businessDate(new Date(), 'Asia/Bangkok');

/** Places an order and walks it all the way to collected, the way a day goes. */
async function sell(
  lines: Array<{ itemId: string; qty?: number; optionIds?: string[] }>,
  paymentMethod: 'cash' | 'promptpay' = 'cash',
): Promise<string> {
  const placed = await harness.app.inject({
    method: 'POST',
    url: `/s/${harness.slug}/orders`,
    payload: { clientId: uuid(), lines },
  });
  // Asserted, not assumed: a rejected order here would otherwise show up as a
  // report that quietly reads zero, which looks like a bug in the report.
  expect(placed.statusCode, JSON.stringify(placed.json())).toBe(201);
  const id = placed.json().id as string;

  for (const step of ['accept', 'ready']) {
    const moved = await harness.app.inject({
      method: 'POST',
      url: `/vendor/orders/${id}/${step}`,
      headers: auth(harness.token),
    });
    expect(moved.statusCode).toBe(200);
  }

  const completed = await harness.app.inject({
    method: 'POST',
    url: `/vendor/orders/${id}/complete`,
    headers: auth(harness.token),
    payload: { paymentMethod },
  });
  expect(completed.statusCode).toBe(200);

  return id;
}

const padThai = (optionIds: string[] = []) => ({
  itemId: harness.items['Pad Thai'] as string,
  qty: 1,
  optionIds: optionIds.length ? optionIds : [harness.options['Mild'] as string],
});

const water = (qty = 1) => ({ itemId: harness.items['Water'] as string, qty });

const facts = async () => {
  const response = await harness.app.inject({
    method: 'GET',
    url: '/vendor/report',
    headers: auth(harness.token),
  });
  return response;
};

describe('GET /vendor/report', () => {
  it('needs a signed-in stall', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/vendor/report' });
    expect(response.statusCode).toBe(401);
  });

  it('returns a zeroed day before anything is sold', async () => {
    const response = await facts();
    expect(response.statusCode).toBe(200);
    expect(response.json().facts.takings).toEqual({
      gross: 0,
      orders: 0,
      averageOrder: 0,
      dishesSold: 0,
      distinctDishes: 0,
    });
  });

  it('defaults to today in the stall timezone', async () => {
    const response = await facts();
    expect(response.json().range).toEqual({ from: today(), to: today() });
  });

  it('counts a completed sale, priced from the menu', async () => {
    await sell([padThai([harness.options['Mild'] as string, harness.options['Prawns'] as string])]);

    const body = (await facts()).json();
    // 60 for the dish, 30 for the prawns.
    expect(body.facts.takings.gross).toBe(90);
    expect(body.facts.takings.orders).toBe(1);
    expect(body.facts.dishes[0]).toMatchObject({
      name: 'Pad Thai',
      qty: 1,
      baht: 90,
      shareOfTakings: 100,
    });
  });

  it('leaves an order still in the queue out of takings', async () => {
    await harness.app.inject({
      method: 'POST',
      url: `/s/${harness.slug}/orders`,
      payload: { clientId: uuid(), lines: [padThai()] },
    });

    const body = (await facts()).json();
    expect(body.facts.takings.gross).toBe(0);
    expect(body.facts.unfinished).toMatchObject({ open: 1, openBaht: 60 });
  });

  it('ranks dishes by money and reports the option attach rate', async () => {
    await sell([padThai([harness.options['Mild'] as string, harness.options['Fried egg'] as string])]);
    await sell([water(3)]);

    const body = (await facts()).json();
    expect(body.facts.dishes.map((dish: { name: string }) => dish.name)).toEqual([
      'Pad Thai',
      'Water',
    ]);
    const egg = body.facts.options.find((o: { name: string }) => o.name === 'Fried egg');
    expect(egg).toMatchObject({ qty: 1, baht: 10, attachRate: 25 });
  });

  it('splits cash from PromptPay', async () => {
    await sell([water()], 'cash');
    await sell([water()], 'promptpay');

    const body = (await facts()).json();
    expect(body.facts.payment.cash).toEqual({ orders: 1, baht: 10 });
    expect(body.facts.payment.promptpay).toEqual({ orders: 1, baht: 10 });
  });

  it('compares against the equivalent stretch before, even when it is empty', async () => {
    await sell([water()]);
    const body = (await facts()).json();
    expect(body.facts.movement).toEqual({
      previousGross: 0,
      previousOrders: 0,
      grossDelta: 10,
      grossPercent: null,
      ordersDelta: 1,
    });
  });

  it('rejects a range that ends before it starts', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/vendor/report?from=2026-08-05&to=2026-08-01',
      headers: auth(harness.token),
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a range longer than a quarter', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/vendor/report?from=2026-01-01&to=2026-12-31',
      headers: auth(harness.token),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('range_too_long');
  });

  it('rejects a date that is not a date', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/vendor/report?from=yesterday',
      headers: auth(harness.token),
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a date that looks formatted but is not real', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/vendor/report?from=2026-02-31',
      headers: auth(harness.token),
    });
    expect(response.statusCode).toBe(400);
  });

  it('does not leak another stall into the figures', async () => {
    await sell([water()]);
    const other = await harness.app.inject({
      method: 'POST',
      url: '/vendor/register',
      payload: { name: 'Next Door', slug: 'nextdoor', pin: '4321' },
    });

    const response = await harness.app.inject({
      method: 'GET',
      url: '/vendor/report',
      headers: auth(other.json().token),
    });
    expect(response.json().facts.takings.gross).toBe(0);
  });
});

describe('POST /vendor/report/brief', () => {
  const write = (payload: Record<string, unknown> = {}) =>
    harness.app.inject({
      method: 'POST',
      url: '/vendor/report/brief',
      headers: auth(harness.token),
      payload,
    });

  /** Three completed orders is the floor for narrating. */
  const aDaysTrade = async () => {
    await sell([padThai()]);
    await sell([water(2)]);
    await sell([padThai([harness.options['Thai hot'] as string])], 'promptpay');
  };

  it('holds off on a day too thin to describe honestly', async () => {
    await sell([water()]);
    const response = await write();

    expect(response.statusCode).toBe(200);
    expect(response.json().brief).toBeNull();
    expect(response.json().skipped).toBe('not_enough_trade');
    expect(narrator.calls).toHaveLength(0);
  });

  it('writes the day up once there is a day to write about', async () => {
    await aDaysTrade();
    const response = await write();

    expect(response.statusCode).toBe(200);
    expect(response.json().brief.headline).toBe('Steady lunch');
    expect(response.json().model).toBe('stub-model');
    expect(narrator.calls).toHaveLength(1);
  });

  it('hands the model computed figures and no raw orders', async () => {
    await aDaysTrade();
    await write();

    const sent = narrator.calls[0];
    expect(sent?.stallName).toBe('Test Stall');
    expect(sent?.facts.takings.gross).toBe(140);
    // Nothing order-shaped goes across: no ids, no clientIds, no queue numbers.
    const serialised = JSON.stringify(sent?.facts);
    expect(serialised).not.toContain('queueNo');
    expect(serialised).not.toContain('clientId');
  });

  it('returns the figures alongside the words, so the two cannot disagree', async () => {
    await aDaysTrade();
    const body = (await write()).json();

    expect(body.facts.takings.gross).toBe(140);
    expect(body.facts.takings.gross).toBe(narrator.calls[0]?.facts.takings.gross);
  });

  it('defaults to Thai and honours an explicit language', async () => {
    await aDaysTrade();
    await write();
    expect(narrator.calls[0]?.language).toBe('th');

    await write({ language: 'en' });
    expect(narrator.calls[1]?.language).toBe('en');
  });

  it('does not pay twice for the same figures', async () => {
    await aDaysTrade();
    const first = await write();
    const second = await write();

    expect(narrator.calls).toHaveLength(1);
    expect(second.json().cached).toBe(true);
    expect(first.json().cached).toBe(false);
    expect(second.json().brief).toEqual(first.json().brief);
  });

  it('rewrites once the figures actually move', async () => {
    await aDaysTrade();
    await write();
    await sell([padThai()]);
    await write();

    expect(narrator.calls).toHaveLength(2);
    expect(narrator.calls[1]?.facts.takings.gross).toBe(200);
  });

  it('caches per language rather than serving Thai to an English request', async () => {
    await aDaysTrade();
    await write({ language: 'th' });
    const english = await write({ language: 'en' });

    expect(narrator.calls).toHaveLength(2);
    expect(english.json().brief.language).toBe('en');
  });

  it('surfaces a model failure rather than inventing a report', async () => {
    await aDaysTrade();
    narrator.failWith = new Error('model exploded');
    const response = await write();

    expect(response.statusCode).toBe(500);
    expect(response.json().brief).toBeUndefined();
  });

  it('still refuses a bad range', async () => {
    const response = await write({ from: '2026-08-05', to: '2026-08-01' });
    expect(response.statusCode).toBe(400);
  });

  it('needs a signed-in stall', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/vendor/report/brief',
      payload: {},
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('with no API key configured', () => {
  let bare: Harness;

  beforeAll(async () => {
    bare = await createHarness({ narrator: null });
  });

  afterAll(async () => {
    await bare.close();
  });

  // Runs after the outer beforeEach, which truncates and re-seeds the stall
  // this second app also points at — its token would otherwise name a vendor
  // that no longer exists.
  beforeEach(async () => {
    await bare.reset();
  });

  it('still serves the figures — they never needed a model', async () => {
    const response = await bare.app.inject({
      method: 'GET',
      url: '/vendor/report',
      headers: auth(bare.token),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().facts.takings.gross).toBe(0);
  });

  it('writes a deterministic template note without an AI key', async () => {
    for (let i = 0; i < 3; i += 1) {
      const placed = await bare.app.inject({
        method: 'POST',
        url: `/s/${bare.slug}/orders`,
        payload: {
          clientId: uuid(),
          lines: [{ itemId: bare.items['Water'] as string, qty: 1 }],
        },
      });
      const id = placed.json().id as string;
      for (const step of ['accept', 'ready']) {
        await bare.app.inject({
          method: 'POST',
          url: `/vendor/orders/${id}/${step}`,
          headers: auth(bare.token),
        });
      }
      await bare.app.inject({
        method: 'POST',
        url: `/vendor/orders/${id}/complete`,
        headers: auth(bare.token),
        payload: { paymentMethod: 'cash' },
      });
    }

    const response = await bare.app.inject({
      method: 'POST',
      url: '/vendor/report/brief',
      headers: auth(bare.token),
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().model).toBe('template');
    expect(response.json().brief).toMatchObject({
      headline: '฿30 จาก 3 ออเดอร์',
      language: 'th',
    });
    expect(response.json().usage).toBeNull();
  });
});
