import { businessDate } from '@khaidee/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Assistant } from '../lib/assistant.js';
import {
  type Harness,
  auth,
  createHarness,
  stubNarrator,
  uuid,
} from './harness.js';

/**
 * The gate is enforced on this side of the wire.
 *
 * The app hides what a stall has not paid for, but that is courtesy — these
 * tests are what makes it true. A vendor with curl and a token should get 402,
 * not the feature.
 */

const alwaysAnswers: Assistant = {
  async ask() {
    return {
      reply: 'stub',
      toolCalls: [],
      model: 'stub',
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  },
};

let harness: Harness;

beforeAll(async () => {
  harness = await createHarness({
    narrator: stubNarrator(),
    assistant: alwaysAnswers,
  });
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
});

const today = () => businessDate(new Date(), 'Asia/Bangkok');

const yesterday = () => {
  const day = new Date();
  day.setUTCDate(day.getUTCDate() - 1);
  return businessDate(day, 'Asia/Bangkok');
};

/** Inside the 92-day report cap, so the range is valid. */
const weekAgo = () => {
  const day = new Date();
  day.setUTCDate(day.getUTCDate() - 7);
  return businessDate(day, 'Asia/Bangkok');
};

const get = (url: string) =>
  harness.app.inject({ method: 'GET', url, headers: auth(harness.token) });

const post = (url: string, payload: Record<string, unknown> = {}) =>
  harness.app.inject({
    method: 'POST',
    url,
    headers: auth(harness.token),
    payload,
  });

/** Three completed sales, so the report has something to narrate. */
async function aDaysTrade() {
  for (let i = 0; i < 3; i += 1) {
    const placed = await harness.app.inject({
      method: 'POST',
      url: `/s/${harness.slug}/orders`,
      payload: {
        clientId: uuid(),
        lines: [{ itemId: harness.items['Water'] as string, qty: 1 }],
      },
    });
    const id = placed.json().id as string;
    for (const step of ['accept', 'ready']) {
      await harness.app.inject({
        method: 'POST',
        url: `/vendor/orders/${id}/${step}`,
        headers: auth(harness.token),
      });
    }
    await post(`/vendor/orders/${id}/complete`, { paymentMethod: 'cash' });
  }
}

describe('what a free stall gets', () => {
  beforeEach(async () => {
    await harness.setTier('free');
  });

  it('records sales and works the queue', async () => {
    await aDaysTrade();
    expect((await get('/vendor/orders')).statusCode).toBe(200);
    expect((await get('/vendor/menu')).statusCode).toBe(200);
  });

  it("reads today's figures", async () => {
    expect((await get('/vendor/report')).statusCode).toBe(200);
  });

  it("gets today's written report, which is the argument for paying", async () => {
    await aDaysTrade();
    const response = await post('/vendor/report/brief');
    expect(response.statusCode).toBe(200);
    expect(response.json().brief).not.toBeNull();
  });

  it('reads yesterday', async () => {
    const day = yesterday();
    const response = await get(`/vendor/report?from=${day}&to=${day}`);
    expect(response.statusCode).toBe(200);
  });

  it('reads a range', async () => {
    const response = await get(`/vendor/report?from=${weekAgo()}&to=${today()}`);
    expect(response.statusCode).toBe(200);
  });

  it('can have a range written up too', async () => {
    await aDaysTrade();
    const response = await post('/vendor/report/brief', {
      from: weekAgo(),
      to: today(),
    });
    expect(response.statusCode).toBe(200);
  });

  it('forecasts tomorrow', async () => {
    const response = await get('/vendor/forecast/tomorrow');
    expect(response.statusCode).toBe(200);
  });

  it('uses the assistant', async () => {
    const response = await post('/vendor/assistant', { question: 'How did today go?' });
    expect(response.statusCode).toBe(200);
  });

  it('is told the price only for optional growth services', async () => {
    const plans = (await get('/vendor/plans')).json();
    expect(plans.features.annual_health_check).toBe('pro');
    expect(plans.features.assistant).toBe('free');
  });
});

describe('what Pro adds', () => {
  beforeEach(async () => {
    await harness.setTier('pro');
  });

  it('opens history and ranges', async () => {
    expect((await get(`/vendor/report?from=${weekAgo()}&to=${today()}`)).statusCode).toBe(200);
  });

  it('opens tomorrow', async () => {
    expect((await get('/vendor/forecast/tomorrow')).statusCode).toBe(200);
  });

  it('opens the assistant', async () => {
    const response = await post('/vendor/assistant', { question: 'How did today go?' });
    expect(response.statusCode).toBe(200);
    expect(response.json().reply).toBe('stub');
  });

  it('still keeps a human expert behind Premium', async () => {
    const plans = (await get('/vendor/plans')).json();
    expect(plans.features.expert_matching).toBe('premium');
    expect(plans.current).toBe('pro');
  });
});

describe('what the stall is told about its plan', () => {
  it('reports the tier and its features at sign-in', async () => {
    await harness.setTier('pro');
    const response = await harness.app.inject({
      method: 'POST',
      url: '/vendor/session',
      payload: { slug: harness.slug, pin: '1234' },
    });

    expect(response.json().vendor.tier).toBe('pro');
    expect(response.json().plan.price).toBe(299);
    expect(response.json().plan.features).toContain('assistant');
    expect(response.json().plan.features).not.toContain('expert_matching');
  });

  it('starts a brand new stall on free', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/vendor/register',
      payload: { name: 'Brand New', slug: 'brandnew', pin: '9999' },
    });

    expect(response.json().vendor.tier).toBe('free');
    expect(response.json().plan.price).toBe(0);
  });

  it('serves the plans from the server, so a price change needs no release', async () => {
    const body = (await get('/vendor/plans')).json();
    expect(body.plans.map((p: { tier: string }) => p.tier)).toEqual([
      'free',
      'pro',
      'premium',
    ]);
    expect(body.plans.map((p: { price: number }) => p.price)).toEqual([0, 299, 1700]);
  });

  it('carries Thai for every plan, so the screen is not half translated', async () => {
    const body = (await get('/vendor/plans')).json();
    for (const plan of body.plans) {
      expect(plan.nameTh.length).toBeGreaterThan(0);
      expect(plan.linesTh).toHaveLength(plan.linesEn.length);
    }
  });

  it('needs a signed-in stall to see them', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/vendor/plans' });
    expect(response.statusCode).toBe(401);
  });
});
