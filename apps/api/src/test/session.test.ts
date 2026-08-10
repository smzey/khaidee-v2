import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Harness, auth, createHarness } from './harness.js';

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

describe('vendor session refresh', () => {
  it('returns the current stall for a valid remembered token', async () => {
    const response = await h.app.inject({
      method: 'GET',
      url: '/vendor/session',
      headers: auth(h.token),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      vendor: {
        id: h.vendorId,
        slug: h.slug,
        name: 'Test Stall',
        promptpayId: '0812345678',
        isOpen: true,
        tier: 'premium',
      },
      plan: {
        tier: 'premium',
      },
    });
    expect(response.json()).not.toHaveProperty('token');
  });

  it('rejects a bad remembered token instead of returning stale stall data', async () => {
    const response = await h.app.inject({
      method: 'GET',
      url: '/vendor/session',
      headers: auth('definitely.bad.token'),
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('unauthorized');
  });
});
