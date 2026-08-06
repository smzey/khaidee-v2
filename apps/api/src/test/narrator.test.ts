import { buildReport } from '@khaidee/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { xaiNarrator } from '../lib/narrator.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const facts = buildReport({
  orders: [],
  from: '2026-08-06',
  to: '2026-08-06',
  timeZone: 'Asia/Bangkok',
});

describe('xAI report narrator', () => {
  it('asks Grok for the report brief as strict JSON', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        model: 'grok-test',
        choices: [
          {
            message: {
              content: JSON.stringify({
                headline: 'Quiet day',
                summary: 'Sales were quiet today.',
                wins: ['Cash stayed clean at ฿0'],
                watch: [],
                actions: [
                  {
                    action: 'Keep prep light tonight',
                    because: 'The report shows ฿0 gross',
                    when: 'tonight',
                  },
                ],
                language: 'en',
              }),
            },
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 8 },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const narration = await xaiNarrator('test-key').write({
      stallName: 'Test Stall',
      facts,
      language: 'en',
    });

    expect(narration.brief.headline).toBe('Quiet day');
    expect(narration.model).toBe('grok-test');
    expect(narration.usage).toEqual({ inputTokens: 12, outputTokens: 8 });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.x.ai/v1/chat/completions');
    expect(init.headers).toMatchObject({
      authorization: 'Bearer test-key',
      'content-type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toMatchObject({
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'khaidee_report_brief',
          strict: true,
        },
      },
    });
  });

  it('turns a rejected key into a vendor-safe error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ error: { message: 'bad key' } }, { status: 401 }),
      ),
    );

    await expect(
      xaiNarrator('bad-key').write({ stallName: 'Test Stall', facts, language: 'en' }),
    ).rejects.toMatchObject({ status: 502, code: 'ai_key_rejected' });
  });
});
