import { businessDate } from '@khaidee/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Harness, auth, createHarness, uuid } from './harness.js';

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.reset();
});

const place = (clientId = uuid()) =>
  h.app.inject({
    method: 'POST',
    url: `/s/${h.slug}/orders`,
    payload: {
      clientId,
      lines: [
        {
          itemId: h.items['Pad Thai'],
          qty: 1,
          optionIds: [h.options['Mild']],
        },
      ],
    },
  });

const move = (id: string, step: 'accept' | 'ready' | 'complete' | 'cancel') => {
  const base = {
    method: 'POST' as const,
    url: `/vendor/orders/${id}/${step}`,
    headers: auth(h.token),
  };
  return step === 'complete'
    ? h.app.inject({ ...base, payload: { paymentMethod: 'cash' } })
    : h.app.inject(base);
};

const complete = async () => {
  const placed = await place();
  const id = placed.json().id as string;
  await move(id, 'accept');
  await move(id, 'ready');
  return move(id, 'complete');
};

describe('GET /vendor/history', () => {
  it('returns finished orders inside the requested business-date range', async () => {
    const done = await complete();
    const day = done.json().businessDate;

    const response = await h.app.inject({
      method: 'GET',
      url: `/vendor/history?from=${day}&to=${day}`,
      headers: auth(h.token),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().range).toEqual({ from: day, to: day });
    expect(response.json().orders.map((order: { id: string }) => order.id)).toEqual([
      done.json().id,
    ]);
  });

  it('includes cancelled orders but not active queue orders', async () => {
    const done = await complete();
    const cancelled = await place();
    await move(cancelled.json().id, 'cancel');
    await place();

    const response = await h.app.inject({
      method: 'GET',
      url: `/vendor/history?from=${done.json().businessDate}&to=${done.json().businessDate}`,
      headers: auth(h.token),
    });

    expect(response.json().orders.map((order: { status: string }) => order.status)).toEqual([
      'cancelled',
      'completed',
    ]);
  });

  it('defaults to today in the vendor timezone', async () => {
    const today = businessDate(new Date(), 'Asia/Bangkok');
    const response = await h.app.inject({
      method: 'GET',
      url: '/vendor/history',
      headers: auth(h.token),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().range).toEqual({ from: today, to: today });
  });

  it('rejects ranges longer than 92 days', async () => {
    const response = await h.app.inject({
      method: 'GET',
      url: '/vendor/history?from=2026-01-01&to=2026-05-01',
      headers: auth(h.token),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('range_too_long');
  });
});
