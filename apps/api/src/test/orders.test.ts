import { verifyPayload } from '@khaidee/domain';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
afterEach(() => {
  vi.unstubAllGlobals();
});

const place = (
  lines: Array<{ itemId: string; qty: number; optionIds?: string[] }>,
  clientId = uuid(),
) =>
  h.app.inject({
    method: 'POST',
    url: `/s/${h.slug}/orders`,
    payload: { lines, clientId },
  });

describe('the storefront a QR opens', () => {
  it('returns the stall and its menu', async () => {
    const res = await h.app.inject({ method: 'GET', url: `/s/${h.slug}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().vendor.name).toBe('Test Stall');
    expect(res.json().menu).toHaveLength(3);
  });

  it('lists the menu in the vendor\'s arranged order', async () => {
    const res = await h.app.inject({ method: 'GET', url: `/s/${h.slug}` });
    expect(res.json().menu.map((m: { nameEn: string }) => m.nameEn)).toEqual([
      'Pad Thai',
      'Thai Tea',
      'Water',
    ]);
  });

  it('404s an unknown stall', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/s/nobody' });
    expect(res.statusCode).toBe(404);
  });
});

describe('placing an order', () => {
  it('prices it from the server menu and assigns queue number 1', async () => {
    const res = await place([
      { itemId: h.items['Pad Thai'] as string, qty: 1, optionIds: [h.options['Mild'] as string] },
      { itemId: h.items['Thai Tea'] as string, qty: 2 },
    ]);

    expect(res.statusCode).toBe(201);
    const order = res.json();
    expect(order.total).toBe(110);
    expect(order.queueNo).toBe(1);
    expect(order.status).toBe('placed');
    expect(order.source).toBe('customer');
    expect(order.paymentMethod).toBeNull();
  });

  /**
   * The test the whole architecture exists for. A client that sends its own
   * prices must not be able to set them.
   */
  it('ignores any price the client tries to send', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/s/${h.slug}/orders`,
      payload: {
        clientId: uuid(),
        lines: [
          { itemId: h.items['Pad Thai'], qty: 1, optionIds: [h.options['Mild']], unitPrice: 1, price: 1 },
          { itemId: h.items['Thai Tea'], qty: 1, unitPrice: 0 },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().total).toBe(85);
    expect(res.json().lines.map((l: { unitPrice: number }) => l.unitPrice)).toEqual(
      [60, 25],
    );
  });

  it('snapshots the name sold under, so a later rename cannot rewrite history', async () => {
    const res = await place([{ itemId: h.items['Pad Thai'] as string, qty: 1, optionIds: [h.options['Mild'] as string] }]);
    expect(res.json().lines[0].nameSnapshot).toBe('Pad Thai');
  });

  it('numbers the queue 1, 2, 3 as orders arrive', async () => {
    const nos: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await place([{ itemId: h.items['Water'] as string, qty: 1 }]);
      nos.push(res.json().queueNo);
    }
    expect(nos).toEqual([1, 2, 3]);
  });

  it('gives every simultaneous order its own queue number', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        place([{ itemId: h.items['Water'] as string, qty: 1 }]),
      ),
    );

    expect(results.every((r) => r.statusCode === 201)).toBe(true);
    const nos = results.map((r) => r.json().queueNo).sort((a, b) => a - b);
    expect(nos).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('collapses duplicate lines for the same item', async () => {
    const res = await place([
      { itemId: h.items['Thai Tea'] as string, qty: 1 },
      { itemId: h.items['Thai Tea'] as string, qty: 2 },
    ]);
    expect(res.json().total).toBe(75);
    expect(res.json().lines).toHaveLength(1);
    expect(res.json().lines[0].qty).toBe(3);
  });

  it('rejects an empty cart', async () => {
    const res = await place([]);
    expect(res.statusCode).toBe(400);
  });

  it('rejects a cart of only unknown items', async () => {
    const res = await place([{ itemId: uuid(), qty: 1 }]);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('items_unavailable');
  });

  it('pushes a remote notification to registered vendor phones', async () => {
    const pushFetch = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal('fetch', pushFetch);

    const registered = await h.app.inject({
      method: 'POST',
      url: '/vendor/push-token',
      headers: auth(h.token),
      payload: { token: 'ExpoPushToken[test_123]', platform: 'ios' },
    });
    expect(registered.statusCode).toBe(200);

    const res = await place([{ itemId: h.items['Water'] as string, qty: 1 }]);
    expect(res.statusCode).toBe(201);

    await vi.waitFor(() => expect(pushFetch).toHaveBeenCalledTimes(1));
    const [url, init] = pushFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://exp.host/--/api/v2/push/send');
    expect(JSON.parse(init.body as string)).toEqual([
      expect.objectContaining({
        to: 'ExpoPushToken[test_123]',
        title: 'New order #1',
        body: '1 item · Water · ฿10',
        data: { orderId: res.json().id },
      }),
    ]);
  });
});

describe('idempotency', () => {
  it('a resent order returns the original rather than a second one', async () => {
    const clientId = uuid();
    const lines = [{ itemId: h.items['Pad Thai'] as string, qty: 1, optionIds: [h.options['Mild'] as string] }];

    const first = await place(lines, clientId);
    const retry = await place(lines, clientId);

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().id).toBe(first.json().id);
    expect(retry.json().queueNo).toBe(first.json().queueNo);
  });

  it('a double tap fired at the same instant still makes one order', async () => {
    const clientId = uuid();
    const lines = [{ itemId: h.items['Pad Thai'] as string, qty: 1, optionIds: [h.options['Mild'] as string] }];

    const [a, b] = await Promise.all([
      place(lines, clientId),
      place(lines, clientId),
    ]);

    expect(a.json().id).toBe(b.json().id);

    const queue = await h.app.inject({
      method: 'GET',
      url: '/vendor/orders',
      headers: auth(h.token),
    });
    expect(queue.json()).toHaveLength(1);
  });
});

describe('sold out and closed', () => {
  it('409s naming the item that sold out since the page loaded', async () => {
    await h.app.inject({
      method: 'POST',
      url: `/vendor/menu/${h.items['Pad Thai']}/availability`,
      headers: auth(h.token),
      payload: { isAvailable: false },
    });

    const res = await place([
      { itemId: h.items['Pad Thai'] as string, qty: 1, optionIds: [h.options['Mild'] as string] },
      { itemId: h.items['Thai Tea'] as string, qty: 1 },
    ]);

    expect(res.statusCode).toBe(409);
    expect(res.json().message).toBe('Pad Thai just sold out');
    expect(res.json().details.items[0].name).toBe('Pad Thai');
  });

  it('423s when the stall is shut', async () => {
    await h.app.inject({
      method: 'POST',
      url: '/vendor/open',
      headers: auth(h.token),
      payload: { isOpen: false },
    });

    const res = await place([{ itemId: h.items['Water'] as string, qty: 1 }]);
    expect(res.statusCode).toBe(423);
    expect(res.json().code).toBe('stall_closed');
  });

  it('lets the vendor ring up a walk-up even with the stall shut', async () => {
    await h.app.inject({
      method: 'POST',
      url: '/vendor/open',
      headers: auth(h.token),
      payload: { isOpen: false },
    });

    const res = await h.app.inject({
      method: 'POST',
      url: '/vendor/orders',
      headers: auth(h.token),
      payload: {
        clientId: uuid(),
        lines: [{ itemId: h.items['Water'], qty: 1 }],
        paymentMethod: 'cash',
      },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe('the order lifecycle', () => {
  const openOrder = async () => {
    const res = await place([
      { itemId: h.items['Pad Thai'] as string, qty: 1, optionIds: [h.options['Mild'] as string] },
      { itemId: h.items['Thai Tea'] as string, qty: 1 },
    ]);
    return res.json().id as string;
  };

  const move = (id: string, step: string, payload?: unknown) =>
    h.app.inject({
      method: 'POST',
      url: `/vendor/orders/${id}/${step}`,
      headers: auth(h.token),
      ...(payload ? { payload } : {}),
    });

  it('walks placed → accepted → ready → completed', async () => {
    const id = await openOrder();

    expect((await move(id, 'accept')).json().status).toBe('accepted');
    expect((await move(id, 'ready')).json().status).toBe('ready');

    const done = await move(id, 'complete', { paymentMethod: 'cash' });
    expect(done.json().status).toBe('completed');
    expect(done.json().paymentMethod).toBe('cash');
    expect(done.json().completedAt).not.toBeNull();
  });

  it('stamps a timestamp at each step and keeps the earlier ones', async () => {
    const id = await openOrder();
    await move(id, 'accept');
    await move(id, 'ready');
    const done = (await move(id, 'complete', { paymentMethod: 'promptpay' })).json();

    expect(done.acceptedAt).not.toBeNull();
    expect(done.readyAt).not.toBeNull();
    expect(new Date(done.acceptedAt).getTime()).toBeLessThanOrEqual(
      new Date(done.readyAt).getTime(),
    );
  });

  it('409s on skipping a step', async () => {
    const id = await openOrder();
    const res = await move(id, 'ready');
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('illegal_transition');
    expect(res.json().details).toEqual({ from: 'placed', to: 'ready' });
  });

  it('refuses to complete without a payment method', async () => {
    const id = await openOrder();
    await move(id, 'accept');
    await move(id, 'ready');
    const res = await move(id, 'complete', {});
    expect(res.statusCode).toBe(400);
  });

  it('409s on reopening a completed order', async () => {
    const id = await openOrder();
    await move(id, 'accept');
    await move(id, 'ready');
    await move(id, 'complete', { paymentMethod: 'cash' });
    expect((await move(id, 'accept')).statusCode).toBe(409);
  });

  it('can cancel from placed', async () => {
    const id = await openOrder();
    expect((await move(id, 'cancel')).json().status).toBe('cancelled');
  });

  it('will not let one stall touch another stall\'s order', async () => {
    const id = await openOrder();
    const otherToken = h.token;
    // Re-seeding gives a different vendor id; the old token now points at a
    // stall that no longer owns this order.
    await h.reset();
    const res = await h.app.inject({
      method: 'POST',
      url: `/vendor/orders/${id}/accept`,
      headers: auth(otherToken),
    });
    expect([401, 404]).toContain(res.statusCode);
  });
});

describe('vendor ring-up for walk-ups', () => {
  it('starts in the queue like a customer order', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/vendor/orders',
      headers: auth(h.token),
      payload: {
        clientId: uuid(),
        lines: [{ itemId: h.items['Pad Thai'], qty: 2, optionIds: [h.options['Mild']] }],
        paymentMethod: 'cash',
      },
    });

    expect(res.statusCode).toBe(201);
    const order = res.json();
    expect(order.status).toBe('placed');
    expect(order.source).toBe('vendor');
    expect(order.total).toBe(120);
    expect(order.paymentMethod).toBe('cash');
    expect(order.completedAt).toBeNull();
  });

  it('shares one ledger and one queue sequence with customer orders', async () => {
    await place([{ itemId: h.items['Water'] as string, qty: 1 }]);
    await h.app.inject({
      method: 'POST',
      url: '/vendor/orders',
      headers: auth(h.token),
      payload: {
        clientId: uuid(),
        lines: [{ itemId: h.items['Water'], qty: 1 }],
        paymentMethod: 'cash',
      },
    });

    const day = await h.app.inject({
      method: 'GET',
      url: '/vendor/orders',
      headers: auth(h.token),
    });

    const orders = day.json();
    expect(orders).toHaveLength(2);
    expect(orders.map((o: { source: string }) => o.source).sort()).toEqual([
      'customer',
      'vendor',
    ]);
    expect(orders.map((o: { queueNo: number }) => o.queueNo).sort()).toEqual([1, 2]);
  });

  it('an offline outbox replay does not duplicate the sale', async () => {
    const clientId = uuid();
    const payload = {
      clientId,
      lines: [{ itemId: h.items['Water'], qty: 1 }],
      paymentMethod: 'cash' as const,
    };

    const first = await h.app.inject({
      method: 'POST',
      url: '/vendor/orders',
      headers: auth(h.token),
      payload,
    });
    const replay = await h.app.inject({
      method: 'POST',
      url: '/vendor/orders',
      headers: auth(h.token),
      payload,
    });

    expect(replay.statusCode).toBe(200);
    expect(replay.json().id).toBe(first.json().id);
  });
});

describe('a customer cancelling their own order', () => {
  const placeWith = async (clientId: string) => {
    const res = await place(
      [{ itemId: h.items['Pad Thai'] as string, qty: 1, optionIds: [h.options['Mild'] as string] }],
      clientId,
    );
    return res.json().id as string;
  };

  const cancel = (id: string, clientId: string) =>
    h.app.inject({
      method: 'POST',
      url: `/orders/${id}/cancel`,
      payload: { clientId },
    });

  it('works while the order is still placed', async () => {
    const clientId = uuid();
    const id = await placeWith(clientId);

    const res = await cancel(id, clientId);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('cancelled');
  });

  it('is refused once the stall has accepted', async () => {
    const clientId = uuid();
    const id = await placeWith(clientId);
    await h.app.inject({
      method: 'POST',
      url: `/vendor/orders/${id}/accept`,
      headers: auth(h.token),
    });

    const res = await cancel(id, clientId);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('too_late_to_cancel');
    expect(res.json().details.status).toBe('accepted');
  });

  it('needs the clientId, not just the order id', async () => {
    const id = await placeWith(uuid());
    const res = await cancel(id, uuid());
    expect(res.statusCode).toBe(404);
  });

  it('cannot be done twice', async () => {
    const clientId = uuid();
    const id = await placeWith(clientId);
    await cancel(id, clientId);

    const again = await cancel(id, clientId);
    expect(again.statusCode).toBe(409);
    expect(again.json().message).toBe('That order was already cancelled');
  });

  it('reaches the vendor screen as an event', async () => {
    const clientId = uuid();
    const id = await placeWith(clientId);
    await cancel(id, clientId);

    const body = await readReplay('/vendor/stream?lastEventId=0');
    expect(body).toContain('"status":"cancelled"');
  });

  it('frees nothing in the queue — numbers are not reused', async () => {
    const clientId = uuid();
    const first = await placeWith(clientId);
    await cancel(first, clientId);

    const second = await place([{ itemId: h.items['Water'] as string, qty: 1 }]);
    expect(second.json().queueNo).toBe(2);
  });
});

describe('the collect screen', () => {
  it('returns the amount owed and a PromptPay payload for exactly it', async () => {
    const id = (
      await place([
        { itemId: h.items['Pad Thai'] as string, qty: 1, optionIds: [h.options['Mild'] as string] },
        { itemId: h.items['Thai Tea'] as string, qty: 2 },
      ])
    ).json().id;

    const res = await h.app.inject({
      method: 'GET',
      url: `/orders/${id}/payment`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(110);

    const payload: string = res.json().promptpayPayload;
    expect(payload).toContain('5406110.00');
    expect(verifyPayload(payload)).toBe(true);
    expect(res.json().promptpayQrDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('offers no payload when the stall has no PromptPay account', async () => {
    await h.clearPromptPay();
    const id = (await place([{ itemId: h.items['Water'] as string, qty: 1 }])).json()
      .id;

    const res = await h.app.inject({
      method: 'GET',
      url: `/orders/${id}/payment`,
    });
    expect(res.json().total).toBe(10);
    expect(res.json().promptpayPayload).toBeNull();
    expect(res.json().promptpayQrDataUrl).toBeNull();
  });

  it('404s an unknown order', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/orders/${uuid()}/payment`,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('malformed requests', () => {
  /*
   * A bodyless POST that still declares a JSON content-type is what every
   * fetch client sends unless told otherwise. Fastify rejects it, and this
   * used to fall through to a 500 saying "something went wrong" — which told
   * the client nothing about the one thing it had got wrong.
   */
  it('400s a bodyless POST that claims to send JSON, rather than 500', async () => {
    const id = (await place([{ itemId: h.items['Water'] as string, qty: 1 }])).json()
      .id;

    const res = await h.app.inject({
      method: 'POST',
      url: `/vendor/orders/${id}/accept`,
      headers: { ...auth(h.token), 'content-type': 'application/json' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/body/i);
  });

  it('still accepts the same call with no content-type at all', async () => {
    const id = (await place([{ itemId: h.items['Water'] as string, qty: 1 }])).json()
      .id;

    const res = await h.app.inject({
      method: 'POST',
      url: `/vendor/orders/${id}/accept`,
      headers: auth(h.token),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('accepted');
  });

  it('400s unparseable JSON with a readable message', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/s/${h.slug}/orders`,
      headers: { 'content-type': 'application/json' },
      payload: '{ not json',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).not.toBe('internal_error');
  });
});

describe('vendor auth', () => {
  it('issues a token for the right PIN', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/vendor/session',
      payload: { slug: h.slug, pin: '1234' },
    });
    expect(res.statusCode).toBe(200);
    expect(typeof res.json().token).toBe('string');
  });

  it('rejects the wrong PIN', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/vendor/session',
      payload: { slug: h.slug, pin: '9999' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('answers an unknown stall the same way as a wrong PIN', async () => {
    const unknown = await h.app.inject({
      method: 'POST',
      url: '/vendor/session',
      payload: { slug: 'nobody', pin: '1234' },
    });
    expect(unknown.statusCode).toBe(401);
  });

  it('rejects a tampered token', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/vendor/orders',
      headers: auth(`${h.vendorId}.9999999999999.forged`),
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a missing token', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/vendor/orders' });
    expect(res.statusCode).toBe(401);
  });
});

describe('vendor stall settings', () => {
  it('updates the stall name shown to customers', async () => {
    const updated = await h.app.inject({
      method: 'PATCH',
      url: '/vendor/stall',
      headers: auth(h.token),
      payload: { name: '67 Noodle' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().name).toBe('67 Noodle');

    const storefront = await h.app.inject({ method: 'GET', url: `/s/${h.slug}` });
    expect(storefront.json().vendor.name).toBe('67 Noodle');
  });

  it('updates PromptPay for generated payment QR payloads', async () => {
    const updated = await h.app.inject({
      method: 'PATCH',
      url: '/vendor/stall',
      headers: auth(h.token),
      payload: { promptpayId: '0898765432' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().promptpayId).toBe('0898765432');

    const id = (await place([{ itemId: h.items['Water'] as string, qty: 1 }])).json()
      .id;
    const payment = await h.app.inject({
      method: 'GET',
      url: `/orders/${id}/payment`,
    });
    expect(payment.json().promptpayPayload).toContain('0066898765432');
  });

  it('generates a counter PromptPay QR for ring-up totals', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/vendor/promptpay-qr',
      headers: auth(h.token),
      payload: { amount: 67 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(67);
    expect(res.json().promptpayPayload).toContain('540567.00');
    expect(verifyPayload(res.json().promptpayPayload)).toBe(true);
    expect(res.json().promptpayQrDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('clears PromptPay when the stall becomes cash-only', async () => {
    const updated = await h.app.inject({
      method: 'PATCH',
      url: '/vendor/stall',
      headers: auth(h.token),
      payload: { promptpayId: null },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().promptpayId).toBeNull();

    const id = (await place([{ itemId: h.items['Water'] as string, qty: 1 }])).json()
      .id;
    const payment = await h.app.inject({
      method: 'GET',
      url: `/orders/${id}/payment`,
    });
    expect(payment.json().promptpayPayload).toBeNull();
  });

  it('returns no counter QR when the stall is cash-only', async () => {
    await h.clearPromptPay();

    const res = await h.app.inject({
      method: 'POST',
      url: '/vendor/promptpay-qr',
      headers: auth(h.token),
      payload: { amount: 67 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      total: 67,
      promptpayPayload: null,
      promptpayQrDataUrl: null,
    });
  });

  it('updates the PIN used for sign-in', async () => {
    const updated = await h.app.inject({
      method: 'PATCH',
      url: '/vendor/stall',
      headers: auth(h.token),
      payload: { pin: '9876' },
    });
    expect(updated.statusCode).toBe(200);

    const oldPin = await h.app.inject({
      method: 'POST',
      url: '/vendor/session',
      payload: { slug: h.slug, pin: '1234' },
    });
    const newPin = await h.app.inject({
      method: 'POST',
      url: '/vendor/session',
      payload: { slug: h.slug, pin: '9876' },
    });
    expect(oldPin.statusCode).toBe(401);
    expect(newPin.statusCode).toBe(200);
  });

  it('rejects malformed PromptPay IDs before payment time', async () => {
    const updated = await h.app.inject({
      method: 'PATCH',
      url: '/vendor/stall',
      headers: auth(h.token),
      payload: { promptpayId: 'abc' },
    });
    expect(updated.statusCode).toBe(422);
    expect(updated.json().code).toBe('invalid_promptpay');
  });
});

describe('the replay log', () => {
  it('records an event per placement and per transition', async () => {
    const id = (await place([{ itemId: h.items['Water'] as string, qty: 1 }])).json()
      .id;
    await h.app.inject({
      method: 'POST',
      url: `/vendor/orders/${id}/accept`,
      headers: auth(h.token),
    });

    // A vendor reconnecting from scratch replays everything it missed. The
    // stream stays open by design, so read only until the replay has arrived.
    const body = await readReplay('/vendor/stream?lastEventId=0');

    expect(body).toContain('event: order.placed');
    expect(body).toContain('event: order.updated');
  });

  it('replays only what came after the last id the client saw', async () => {
    const id = (await place([{ itemId: h.items['Water'] as string, qty: 1 }])).json()
      .id;
    await h.app.inject({
      method: 'POST',
      url: `/vendor/orders/${id}/accept`,
      headers: auth(h.token),
    });

    // Event 1 was the placement; a client that already has it asks for more.
    const body = await readReplay('/vendor/stream?lastEventId=1');

    expect(body).toContain('event: order.updated');
    expect(body).not.toContain('event: order.placed');
  });
});

/**
 * Reads an SSE response until it goes quiet, then hangs up. The endpoint
 * deliberately never closes, so the test has to decide when it has seen
 * enough rather than waiting for an end that will not come.
 */
async function readReplay(url: string): Promise<string> {
  const res = await h.app.inject({
    method: 'GET',
    url,
    headers: auth(h.token),
    payloadAsStream: true,
  });

  const stream = res.stream();
  let body = '';

  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      stream.destroy();
      resolve();
    };
    // Replay is written synchronously on connect; 250ms is generous for it.
    const timer = setTimeout(done, 250);
    stream.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    stream.on('end', done);
    stream.on('error', done);
  });

  return body;
}
