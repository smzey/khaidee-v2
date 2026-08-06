import { businessDate } from '@khaidee/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Assistant, AssistantAsk } from '../lib/assistant.js';
import { trimHistory } from '../services/assistant.js';
import { type Harness, auth, createHarness, uuid } from './harness.js';

/**
 * A stand-in for the model that calls the tools we tell it to and reports what
 * came back.
 *
 * The point of these tests is not the model — it is the tool layer, which is
 * the only thing standing between a vendor and a confidently wrong number. So
 * the stub exercises the real tools against a real seeded day and the
 * assertions are about the figures, not the prose.
 */
interface StubAssistant extends Assistant {
  asks: AssistantAsk[];
  /** Tools to call before answering, in order. */
  plan: Array<{ name: string; input?: unknown }>;
  /** Whatever those tools returned. */
  results: unknown[];
  reply: string;
  failWith: Error | null;
}

function stubAssistant(): StubAssistant {
  const stub: StubAssistant = {
    asks: [],
    plan: [],
    results: [],
    reply: 'You took ฿140 today.',
    failWith: null,

    async ask(input) {
      stub.asks.push(input);
      if (stub.failWith) throw stub.failWith;

      stub.results = [];
      const toolCalls: Array<{ name: string; input: unknown }> = [];
      for (const step of stub.plan) {
        const args = step.input ?? {};
        stub.results.push(await input.tools.run(step.name, args));
        toolCalls.push({ name: step.name, input: args });
      }

      return {
        reply: stub.reply,
        toolCalls,
        model: 'stub-model',
        usage: { inputTokens: 200, outputTokens: 40 },
      };
    },
  };
  return stub;
}

let harness: Harness;
let assistant: StubAssistant;

beforeAll(async () => {
  assistant = stubAssistant();
  harness = await createHarness({ assistant });
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
  assistant.asks = [];
  assistant.plan = [];
  assistant.results = [];
  assistant.failWith = null;
});

const today = () => businessDate(new Date(), 'Asia/Bangkok');

async function sell(
  lines: Array<{ itemId: string; qty?: number; optionIds?: string[] }>,
  finish: 'collected' | 'leave_open' = 'collected',
) {
  const placed = await harness.app.inject({
    method: 'POST',
    url: `/s/${harness.slug}/orders`,
    payload: { clientId: uuid(), lines },
  });
  expect(placed.statusCode, JSON.stringify(placed.json())).toBe(201);
  const id = placed.json().id as string;
  if (finish === 'leave_open') return id;

  for (const step of ['accept', 'ready']) {
    await harness.app.inject({
      method: 'POST',
      url: `/vendor/orders/${id}/${step}`,
      headers: auth(harness.token),
    });
  }
  await harness.app.inject({
    method: 'POST',
    url: `/vendor/orders/${id}/complete`,
    headers: auth(harness.token),
    payload: { paymentMethod: 'cash' },
  });
  return id;
}

const padThai = () => ({
  itemId: harness.items['Pad Thai'] as string,
  qty: 1,
  optionIds: [harness.options['Mild'] as string],
});
const water = (qty = 1) => ({ itemId: harness.items['Water'] as string, qty });

/** Drives one question through the route and returns the parsed body. */
const ask = async (question = 'How did today go?', history?: unknown) => {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/vendor/assistant',
    headers: auth(harness.token),
    payload: history ? { question, history } : { question },
  });
  return response;
};

describe('the tools the model is limited to', () => {
  it('tells it the date, because it has no clock of its own', async () => {
    assistant.plan = [{ name: 'get_today' }];
    await ask();

    expect(assistant.results[0]).toEqual({
      today: today(),
      timeZone: 'Asia/Bangkok',
      stall: 'Test Stall',
    });
  });

  it('returns real takings, computed the same way the report is', async () => {
    await sell([padThai()]);
    await sell([water(2)]);

    assistant.plan = [{ name: 'get_report' }];
    await ask();

    const result = assistant.results[0] as { facts: { takings: { gross: number } } };
    expect(result.facts.takings.gross).toBe(80);
  });

  it('defaults an omitted range to today rather than guessing', async () => {
    assistant.plan = [{ name: 'get_report' }];
    await ask();

    const result = assistant.results[0] as { range: { from: string; to: string } };
    expect(result.range).toEqual({ from: today(), to: today() });
  });

  it('ignores a malformed date instead of failing the whole question', async () => {
    assistant.plan = [{ name: 'get_report', input: { from: 'last Tuesday' } }];
    const response = await ask();

    expect(response.statusCode).toBe(200);
    const result = assistant.results[0] as { range: { from: string } };
    expect(result.range.from).toBe(today());
  });

  it('refuses a range longer than the report allows', async () => {
    assistant.plan = [
      { name: 'get_report', input: { from: '2026-01-01', to: '2026-12-31' } },
    ];
    const response = await ask();
    expect(response.statusCode).toBe(400);
  });

  it('puts two periods side by side', async () => {
    await sell([padThai()]);

    assistant.plan = [
      {
        name: 'compare_periods',
        input: {
          firstFrom: '2026-01-01',
          firstTo: '2026-01-01',
          secondFrom: today(),
          secondTo: today(),
        },
      },
    ];
    await ask();

    const result = assistant.results[0] as {
      first: { facts: { takings: { gross: number } } };
      second: { facts: { takings: { gross: number } } };
    };
    expect(result.first.facts.takings.gross).toBe(0);
    expect(result.second.facts.takings.gross).toBe(60);
  });

  it('describes the menu in words, not ids', async () => {
    assistant.plan = [{ name: 'get_menu' }];
    await ask();

    const result = assistant.results[0] as {
      dishes: Array<{ name: string; price: number; priceLabel: string; available: boolean }>;
    };
    const dish = result.dishes.find((d) => d.name === 'Pad Thai');
    expect(dish).toMatchObject({ price: 60, priceLabel: '฿60', available: true });
    // Ids would be tokens the model pays for and can never use.
    expect(JSON.stringify(result)).not.toContain('-4');
  });

  it('carries option prices, so "what does extra prawns cost" is answerable', async () => {
    assistant.plan = [{ name: 'get_menu' }];
    await ask();

    const result = assistant.results[0] as {
      dishes: Array<{
        name: string;
        optionGroups: Array<{ options: Array<{ name: string; priceDelta: number }> }>;
      }>;
    };
    const prawns = result.dishes
      .flatMap((d) => d.optionGroups)
      .flatMap((g) => g.options)
      .find((o) => o.name === 'Prawns');
    expect(prawns?.priceDelta).toBe(30);
  });

  it('shows a sold-out dish as unavailable rather than hiding it', async () => {
    await harness.app.inject({
      method: 'POST',
      url: `/vendor/menu/${harness.items['Water']}/availability`,
      headers: auth(harness.token),
      payload: { isAvailable: false },
    });

    assistant.plan = [{ name: 'get_menu' }];
    await ask();

    const result = assistant.results[0] as {
      dishes: Array<{ name: string; available: boolean }>;
    };
    expect(result.dishes.find((d) => d.name === 'Water')?.available).toBe(false);
  });

  it('counts what is actually on the counter right now', async () => {
    await sell([padThai()], 'leave_open');
    await sell([water()]);

    assistant.plan = [{ name: 'get_queue_now' }];
    await ask();

    expect(assistant.results[0]).toMatchObject({
      waitingToAccept: 1,
      cooking: 0,
      readyToCollect: 0,
      completedToday: 1,
    });
  });

  it('has no oldest order when nothing is open', async () => {
    await sell([water()]);
    assistant.plan = [{ name: 'get_queue_now' }];
    await ask();

    expect(assistant.results[0]).toMatchObject({ oldestOpenMinutes: null });
  });

  it('answers an invented tool name plainly instead of throwing', async () => {
    assistant.plan = [{ name: 'get_profit_margin' }];
    const response = await ask();

    expect(response.statusCode).toBe(200);
    expect(assistant.results[0]).toEqual({
      error: 'There is no tool called get_profit_margin.',
    });
  });

  it('cannot reach another stall', async () => {
    await sell([padThai()]);
    const other = await harness.app.inject({
      method: 'POST',
      url: '/vendor/register',
      payload: { name: 'Next Door', slug: 'nextdoor', pin: '4321' },
    });

    // The assistant is a paid feature, so the neighbour has to be on a plan
    // that includes it before this can test scoping at all.
    await harness.setTier('pro', other.json().vendor.id);

    assistant.plan = [{ name: 'get_report' }];
    await harness.app.inject({
      method: 'POST',
      url: '/vendor/assistant',
      headers: auth(other.json().token),
      payload: { question: 'How did today go?' },
    });

    // The model never supplies a vendor id; the route binds it from the token.
    const result = assistant.results[0] as { facts: { takings: { gross: number } } };
    expect(result.facts.takings.gross).toBe(0);
  });
});

describe('POST /vendor/assistant', () => {
  it('needs a signed-in stall', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/vendor/assistant',
      payload: { question: 'How did today go?' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('answers, and says what it consulted', async () => {
    await sell([padThai()]);
    assistant.plan = [{ name: 'get_today' }, { name: 'get_report' }];

    const response = await ask('How did today go?');
    expect(response.statusCode).toBe(200);
    expect(response.json().reply).toBe('You took ฿140 today.');
    expect(response.json().toolCalls.map((c: { name: string }) => c.name)).toEqual([
      'get_today',
      'get_report',
    ]);
    expect(response.json().stall).toBe('Test Stall');
  });

  it('passes the stall name so the model can use it', async () => {
    await ask();
    expect(assistant.asks[0]?.stallName).toBe('Test Stall');
  });

  it('rejects an empty question', async () => {
    const response = await ask('   ');
    expect(response.statusCode).toBe(400);
  });

  it('rejects an essay', async () => {
    const response = await ask('x'.repeat(501));
    expect(response.statusCode).toBe(400);
  });

  it('carries the thread back to the model', async () => {
    await ask('And last week?', [
      { role: 'user', content: 'How did today go?' },
      { role: 'assistant', content: 'You took ฿140.' },
    ]);

    expect(assistant.asks[0]?.history).toHaveLength(2);
    expect(assistant.asks[0]?.question).toBe('And last week?');
  });

  it('surfaces a model failure rather than inventing an answer', async () => {
    assistant.failWith = new Error('model exploded');
    const response = await ask();
    expect(response.statusCode).toBe(500);
  });
});

describe('with no provider key configured', () => {
  let bare: Harness;

  beforeAll(async () => {
    bare = await createHarness({ assistant: null });
  });

  afterAll(async () => {
    await bare.close();
  });

  beforeEach(async () => {
    await bare.reset();
  });

  it('says plainly that the assistant needs a key', async () => {
    const response = await bare.app.inject({
      method: 'POST',
      url: '/vendor/assistant',
      headers: auth(bare.token),
      payload: { question: 'How did today go?' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('ai_unavailable');
  });
});

describe('trimHistory', () => {
  const user = (content: string) => ({ role: 'user' as const, content });
  const bot = (content: string) => ({ role: 'assistant' as const, content });

  it('keeps a short thread whole', () => {
    const thread = [user('a'), bot('b')];
    expect(trimHistory(thread)).toEqual(thread);
  });

  it('keeps the tail of a long one', () => {
    const thread = Array.from({ length: 30 }, (_, i) =>
      i % 2 === 0 ? user(`q${i}`) : bot(`a${i}`),
    );
    const trimmed = trimHistory(thread);
    expect(trimmed).toHaveLength(12);
    expect(trimmed.at(-1)?.content).toBe('a29');
  });

  it('drops a leading assistant turn, which both providers reject', () => {
    const thread = Array.from({ length: 30 }, (_, i) =>
      i % 2 === 0 ? bot(`a${i}`) : user(`q${i}`),
    );
    expect(trimHistory(thread)[0]?.role).toBe('user');
  });

  it('returns nothing rather than an all-assistant thread', () => {
    expect(trimHistory([bot('a'), bot('b')])).toEqual([]);
  });
});
