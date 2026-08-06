import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { ReportBrief, ReportFacts } from '@khaidee/domain';
import * as z from 'zod/v4';
import { HttpError } from './errors.js';

/**
 * The half of the report a model writes.
 *
 * It is handed nothing but the numbers report.ts already computed, and it is
 * forbidden from producing any others. The schema below is the contract: the
 * model cannot return prose we did not ask for, and it cannot return a number
 * in a numeric field at all — there are none. Everything quantitative was
 * settled before this file ran.
 */

const CLAUDE_MODEL = process.env.KHAIDEE_REPORT_MODEL ?? 'claude-opus-5';
const XAI_MODEL =
  process.env.KHAIDEE_REPORT_XAI_MODEL ??
  process.env.KHAIDEE_REPORT_MODEL ??
  'grok-4.5';
const XAI_BASE_URL = process.env.XAI_BASE_URL ?? 'https://api.x.ai/v1';

/**
 * `medium` is the balance point for this job: the arithmetic is already done,
 * so what is left is judgement about what matters, not reasoning depth.
 */
const EFFORT = (process.env.KHAIDEE_REPORT_EFFORT ?? 'medium') as
  | 'low'
  | 'medium'
  | 'high';

const briefSchema = z.object({
  headline: z
    .string()
    .describe('One short line the vendor reads first. Under 60 characters.'),
  summary: z
    .string()
    .describe('Two or three plain sentences on how the period went.'),
  wins: z
    .array(z.string())
    .describe('One to three things that went well, each citing a figure.'),
  watch: z
    .array(z.string())
    .describe('Zero to three things to keep an eye on, each citing a figure.'),
  actions: z
    .array(
      z.object({
        action: z
          .string()
          .describe('One concrete thing to do, written as an instruction.'),
        because: z.string().describe('The figure this rests on.'),
        /*
         * The SDK's zod-to-JSON-schema step renders enums as a description
         * rather than a schema `enum`, so these are not constrained on the
         * server — spelling the choices out in prose is what actually holds
         * them. Zod still rejects a wrong value on the way back in.
         */
        when: z
          .enum(['tonight', 'this_week'])
          .describe('Exactly one of: "tonight" or "this_week". No other value.'),
      }),
    )
    .describe('One to three actions, most valuable first.'),
  language: z
    .enum(['th', 'en'])
    .describe(
      'The language everything above is written in. Exactly "th" for Thai or "en" for English.',
    ),
});

const briefJsonSchema = {
  type: 'object',
  properties: {
    headline: {
      type: 'string',
      description: 'One short line the vendor reads first. Under 60 characters.',
    },
    summary: {
      type: 'string',
      description: 'Two or three plain sentences on how the period went.',
    },
    wins: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 3,
      description: 'One to three things that went well, each citing a figure.',
    },
    watch: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 3,
      description: 'Zero to three things to keep an eye on, each citing a figure.',
    },
    actions: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      description: 'One to three actions, most valuable first.',
      items: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: 'One concrete thing to do, written as an instruction.',
          },
          because: {
            type: 'string',
            description: 'The figure this rests on.',
          },
          when: {
            type: 'string',
            enum: ['tonight', 'this_week'],
            description: 'Exactly one of: "tonight" or "this_week".',
          },
        },
        required: ['action', 'because', 'when'],
        additionalProperties: false,
      },
    },
    language: {
      type: 'string',
      enum: ['th', 'en'],
      description: 'The language everything above is written in.',
    },
  },
  required: ['headline', 'summary', 'wins', 'watch', 'actions', 'language'],
  additionalProperties: false,
} as const;

/**
 * Compile-time bridge. The clients type against domain's ReportBrief; the model
 * is constrained by the schema above. If the two drift, this stops building.
 */
export const briefMatchesDto: z.infer<typeof briefSchema> extends ReportBrief
  ? true
  : never = true;

const GLOSSARY = `The facts JSON uses these fields:
- takings.gross: baht actually collected. Only completed orders count.
- takings.averageOrder: gross divided by completed orders, rounded.
- takings.dishesSold: total plates, not orders.
- unfinished.open / openBaht: orders still in the queue, money not yet collected.
- unfinished.cancelled / cancelledBaht: orders that fell through.
- payment.unrecorded: completed orders with no payment method recorded.
- channel.customer: ordered by QR. channel.vendor: rung up at the counter.
- dishes[].shareOfTakings: percent of gross.
- options[].attachRate: percent of all plates sold that carried that option.
- hours[].hour: 0-23 on the stall's own clock.
- service.medianMinutesToReady: how long a customer waited for food.
- service.medianMinutesToCollect: how long finished food sat before pickup.
- movement: the same length of time immediately before this period.
  grossPercent is null when the earlier period took nothing.`;

const SYSTEM = `You write the end-of-day note for a Thai street-food vendor using KhaiDee.

You are given a JSON object of figures that have ALREADY been computed from the
stall's real orders. They are correct and final.

Rules, in order of importance:
1. Never produce a number that is not in the facts. Do not add, average,
   project, or convert anything. If you want to say a figure, copy it.
2. Never claim a cause you cannot see. The facts contain no weather, no
   holidays, no competitors, no prices you were not given. "Sales rose because
   of the rain" is invention.
3. Write in the requested language, and only that language.
4. The reader is standing at their cart, tired, holding a phone in one hand.
   Short sentences. Everyday words. No business jargon, no "leverage", no
   "optimise", no percentages that need a calculator to feel.
5. Money is whole baht. Write it as ฿1,250.
6. Actions must be things one person with a wok and a phone can actually do
   before tomorrow. "Prep 10 more Pad Thai before 11:00" is an action.
   "Consider analysing your customer segments" is not.
7. If the period is thin or the figures are unremarkable, say so plainly in one
   short line and give fewer points. Do not pad. An honest "quiet day, nothing
   to change" is more useful than three invented observations.

${GLOSSARY}`;

export interface NarrateInput {
  stallName: string;
  facts: ReportFacts;
  language: 'th' | 'en';
}

export interface Narration {
  brief: ReportBrief;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface Narrator {
  write(input: NarrateInput): Promise<Narration>;
}

/** Whether an API key is configured at all, so routes can 503 early. */
export function narratorConfigured(): boolean {
  return (
    process.env.KHAIDEE_REPORT_AI === 'true' &&
    Boolean(process.env.XAI_API_KEY || process.env.ANTHROPIC_API_KEY)
  );
}

export function configuredNarrator(): Narrator | null {
  if (process.env.KHAIDEE_REPORT_AI !== 'true') return null;
  if (process.env.XAI_API_KEY) return xaiNarrator();
  if (process.env.ANTHROPIC_API_KEY) return claudeNarrator();
  return null;
}

export function claudeNarrator(apiKey?: string): Narrator {
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new HttpError(
      503,
      'ai_unavailable',
      'The written report needs an Anthropic API key. Set ANTHROPIC_API_KEY.',
    );
  }

  const client = new Anthropic({ apiKey: key });

  return {
    async write(input) {
      const request = {
        model: CLAUDE_MODEL,
        max_tokens: 4000,
        // Adaptive is the only accepted form on Opus 5; budget_tokens is a 400.
        thinking: { type: 'adaptive' as const },
        output_config: {
          effort: EFFORT,
          format: betaZodOutputFormat(briefSchema),
        },
        system: SYSTEM,
        messages: [
          {
            role: 'user' as const,
            content: [
              `Stall: ${input.stallName}`,
              `Write in: ${input.language === 'th' ? 'Thai' : 'English'}`,
              '',
              'Facts:',
              JSON.stringify(input.facts),
            ].join('\n'),
          },
        ],
      };

      const response = await client.beta.messages
        .parse({
          ...request,
          // A safety decline on a sales report is close to impossible, but the
          // fallback costs nothing when it never fires and turns the one-in-a-
          // million refusal into a served response instead of a broken screen.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        })
        .catch((error: unknown) => {
          if (!(error instanceof Anthropic.BadRequestError)) throw toHttpError(error);
          // The beta is opt-in and dated. If this account is not on it, the
          // report should still get written rather than fail over a flag.
          return client.beta.messages.parse(request).catch((retryError: unknown) => {
            throw toHttpError(retryError);
          });
        });

      if (response.stop_reason === 'refusal') {
        throw new HttpError(
          502,
          'ai_refused',
          response.stop_details?.explanation ??
            'The model declined to write this report',
        );
      }

      if (!response.parsed_output) {
        throw new HttpError(
          502,
          'ai_malformed',
          'The model did not return a report in the expected shape',
        );
      }

      return {
        brief: response.parsed_output,
        model: response.model,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    },
  };
}

export function xaiNarrator(apiKey?: string): Narrator {
  const key = apiKey ?? process.env.XAI_API_KEY;
  if (!key) {
    throw new HttpError(
      503,
      'ai_unavailable',
      'The written report needs an xAI API key. Set XAI_API_KEY.',
    );
  }

  return {
    async write(input) {
      const response = await fetch(`${XAI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: XAI_MODEL,
          max_tokens: 1200,
          messages: [
            { role: 'system', content: SYSTEM },
            {
              role: 'user',
              content: [
                `Stall: ${input.stallName}`,
                `Write in: ${input.language === 'th' ? 'Thai' : 'English'}`,
                '',
                'Facts:',
                JSON.stringify(input.facts),
              ].join('\n'),
            },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'khaidee_report_brief',
              schema: briefJsonSchema,
              strict: true,
            },
          },
        }),
      }).catch((error: unknown) => {
        throw toXaiHttpError(error);
      });

      if (!response.ok) {
        throw await xaiResponseError(response);
      }

      const body = (await response.json()) as {
        model?: string;
        choices?: Array<{ message?: { content?: string | null } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const content = body.choices?.[0]?.message?.content;
      if (!content) {
        throw new HttpError(
          502,
          'ai_malformed',
          'The model did not return a report in the expected shape',
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        throw new HttpError(
          502,
          'ai_malformed',
          'The model did not return JSON for the report',
        );
      }

      const brief = briefSchema.safeParse(parsed);
      if (!brief.success) {
        throw new HttpError(
          502,
          'ai_malformed',
          'The model did not return a report in the expected shape',
        );
      }

      return {
        brief: brief.data,
        model: body.model ?? XAI_MODEL,
        usage: {
          inputTokens: body.usage?.prompt_tokens ?? 0,
          outputTokens: body.usage?.completion_tokens ?? 0,
        },
      };
    },
  };
}

/** Turns SDK errors into statuses a vendor's phone can act on. */
function toHttpError(error: unknown): unknown {
  if (error instanceof Anthropic.AuthenticationError) {
    return new HttpError(
      502,
      'ai_key_rejected',
      'The Anthropic API key was rejected',
    );
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new HttpError(429, 'ai_rate_limited', 'Too many reports at once — try again shortly');
  }
  if (error instanceof Anthropic.APIError) {
    return new HttpError(502, 'ai_failed', 'The report could not be written just now');
  }
  return error;
}

function toXaiHttpError(error: unknown): unknown {
  if (error instanceof HttpError) return error;
  return new HttpError(502, 'ai_failed', 'The report could not be written just now');
}

async function xaiResponseError(response: Response): Promise<HttpError> {
  const body = await response.json().catch(() => null);
  const message =
    body && typeof body === 'object' && 'error' in body
      ? String((body as { error?: { message?: unknown } }).error?.message ?? '')
      : '';
  if (response.status === 401 || response.status === 403) {
    return new HttpError(502, 'ai_key_rejected', 'The xAI API key was rejected');
  }
  if (response.status === 429) {
    return new HttpError(429, 'ai_rate_limited', 'Too many reports at once - try again shortly');
  }
  if (response.status >= 400 && response.status < 500) {
    return new HttpError(
      502,
      'ai_failed',
      message || 'The xAI request was rejected',
    );
  }
  return new HttpError(502, 'ai_failed', 'The report could not be written just now');
}
