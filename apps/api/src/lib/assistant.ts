import Anthropic from '@anthropic-ai/sdk';
import type { ToolBox, ToolSpec } from './assistantTools.js';
import { HttpError } from './errors.js';

/**
 * The assistant behind the bubble.
 *
 * It is a tool-using loop, not a chat with the stall's data pasted into the
 * prompt, and the difference is the whole point. The model starts every
 * conversation knowing nothing about this stall. To say a number it must first
 * ask for it, and what comes back was computed by packages/domain from real
 * orders. There is no path by which it can arrive at a figure of its own.
 *
 * That is what makes it safe to let a vendor ask anything: the worst case is
 * "I cannot answer that", not a confident wrong number they act on.
 */

const CLAUDE_MODEL = process.env.KHAIDEE_ASSISTANT_MODEL ?? 'claude-opus-5';
const XAI_MODEL =
  process.env.KHAIDEE_ASSISTANT_XAI_MODEL ??
  process.env.KHAIDEE_REPORT_XAI_MODEL ??
  'grok-4.5';
const XAI_BASE_URL = process.env.XAI_BASE_URL ?? 'https://api.x.ai/v1';

/**
 * `low` by default. The vendor is waiting with a wet hand on a phone, and the
 * work here is genuinely easy — pick a tool, read figures that are already
 * correct, write two sentences. Depth buys nothing and costs seconds.
 */
const EFFORT = (process.env.KHAIDEE_ASSISTANT_EFFORT ?? 'low') as
  | 'low'
  | 'medium'
  | 'high';

/**
 * Enough rounds for "what's today" → "get the report" → answer, with room for
 * one correction. A model still calling tools after this has lost the thread,
 * and looping further only spends the vendor's money.
 */
const MAX_ROUNDS = 5;

const MAX_TOKENS = 4000;

export const ASSISTANT_SYSTEM = `You are the assistant inside KhaiDee, the POS a Thai street-food vendor runs their stall on. The person typing owns the stall.

You know NOTHING about this stall except what your tools return. You have no
memory of their sales, no clock, and no way to work anything out for yourself.

Rules, in order of importance:
1. Never state a number that did not come back from a tool in this
   conversation. If you want to say a figure, call a tool and copy it.
2. Never estimate, project, average, or extrapolate. No "roughly", no "about",
   no predictions. The tools return exact figures; anything else is invention.
3. You have no clock. Call get_today before reasoning about any date, including
   "today", "yesterday", "this week" and "last month".
4. If the tools cannot answer, say so in one short line and say what you can
   answer instead. That is a good answer, not a failure.
5. Never claim a cause you cannot see. You have no weather, no holidays, no
   competitors, no foot traffic. "Sales dropped because it rained" is invention
   even when it is true.
6. Reply in the language the vendor wrote in. Thai question, Thai answer.
7. Keep it short. This is a phone screen at a food cart, read one-handed. Two
   or three sentences is usually right. Use a short list only when actually
   listing dishes. No headings, no markdown tables.
8. Money is whole baht, written ฿1,250.
9. Advice is welcome, but it must rest on a figure you fetched, and it must be
   something one person with a wok can do. "Prep 10 more Pad Thai before 11:00"
   is advice. "Consider optimising your product mix" is noise.
10. Never mention tools, functions, JSON, or how you got the data. The vendor
    asked a question about their stall; just answer it.
11. If asked something that has nothing to do with running this stall, say in
    one line that you only help with the stall, and stop.`;

export interface AssistantTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantAnswer {
  reply: string;
  /** Surfaced so a caller can show what was actually consulted. */
  toolCalls: Array<{ name: string; input: unknown }>;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface AssistantAsk {
  stallName: string;
  question: string;
  history: AssistantTurn[];
  tools: ToolBox;
}

export interface Assistant {
  ask(input: AssistantAsk): Promise<AssistantAnswer>;
}

export function assistantConfigured(): boolean {
  return Boolean(process.env.XAI_API_KEY || process.env.ANTHROPIC_API_KEY);
}

/** Same precedence as the narrator, so one key configures the whole product. */
export function configuredAssistant(): Assistant | null {
  if (process.env.XAI_API_KEY) return xaiAssistant();
  if (process.env.ANTHROPIC_API_KEY) return claudeAssistant();
  return null;
}

const noKey = (which: string) =>
  new HttpError(
    503,
    'ai_unavailable',
    `The assistant needs an ${which} API key. Set XAI_API_KEY or ANTHROPIC_API_KEY.`,
  );

const ranOut = () =>
  new HttpError(
    502,
    'ai_gave_up',
    'I could not work that out. Try asking it a simpler way.',
  );

/* ------------------------------------------------------------------ *
 * Anthropic
 * ------------------------------------------------------------------ */

export function claudeAssistant(apiKey?: string): Assistant {
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) throw noKey('Anthropic');

  const client = new Anthropic({ apiKey: key });

  return {
    async ask({ stallName, question, history, tools }) {
      const messages: Anthropic.MessageParam[] = [
        ...history.map((turn) => ({
          role: turn.role,
          content: turn.content,
        })),
        { role: 'user' as const, content: question },
      ];

      const declared = tools.specs.map((spec) => ({
        name: spec.name,
        description: spec.description,
        input_schema: spec.schema,
      }));

      const called: AssistantAnswer['toolCalls'] = [];
      let inputTokens = 0;
      let outputTokens = 0;
      let model = CLAUDE_MODEL;

      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        const response = await client.messages
          .create({
            model: CLAUDE_MODEL,
            max_tokens: MAX_TOKENS,
            thinking: { type: 'adaptive' },
            output_config: { effort: EFFORT },
            system: `${ASSISTANT_SYSTEM}\n\nThe stall is called "${stallName}".`,
            tools: declared,
            messages,
          })
          .catch((error: unknown) => {
            throw toHttpError(error);
          });

        model = response.model;
        inputTokens += response.usage.input_tokens;
        outputTokens += response.usage.output_tokens;

        if (response.stop_reason === 'refusal') {
          throw new HttpError(
            502,
            'ai_refused',
            response.stop_details?.explanation ?? 'I cannot answer that one.',
          );
        }

        // Pushed whole, not just the text: adaptive thinking blocks have to
        // survive the round trip or the next call rejects the history.
        messages.push({ role: 'assistant', content: response.content });

        const toolUses = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
        );

        if (toolUses.length === 0) {
          const reply = response.content
            .filter((block): block is Anthropic.TextBlock => block.type === 'text')
            .map((block) => block.text)
            .join('\n')
            .trim();

          if (!reply) throw ranOut();
          return { reply, toolCalls: called, model, usage: { inputTokens, outputTokens } };
        }

        const results = await Promise.all(
          toolUses.map(async (use) => {
            called.push({ name: use.name, input: use.input });
            const output = await tools.run(use.name, use.input);
            return {
              type: 'tool_result' as const,
              tool_use_id: use.id,
              content: JSON.stringify(output),
            };
          }),
        );

        messages.push({ role: 'user', content: results });
      }

      throw ranOut();
    },
  };
}

/* ------------------------------------------------------------------ *
 * xAI — OpenAI-compatible chat completions
 * ------------------------------------------------------------------ */

interface XaiToolCall {
  id: string;
  function?: { name?: string; arguments?: string };
}

interface XaiMessage {
  role: string;
  content?: string | null;
  tool_calls?: XaiToolCall[];
  tool_call_id?: string;
}

export function xaiAssistant(apiKey?: string): Assistant {
  const key = apiKey ?? process.env.XAI_API_KEY;
  if (!key) throw noKey('xAI');

  return {
    async ask({ stallName, question, history, tools }) {
      const messages: XaiMessage[] = [
        {
          role: 'system',
          content: `${ASSISTANT_SYSTEM}\n\nThe stall is called "${stallName}".`,
        },
        ...history.map((turn) => ({ role: turn.role, content: turn.content })),
        { role: 'user', content: question },
      ];

      const declared = tools.specs.map((spec: ToolSpec) => ({
        type: 'function',
        function: {
          name: spec.name,
          description: spec.description,
          parameters: spec.schema,
        },
      }));

      const called: AssistantAnswer['toolCalls'] = [];
      let inputTokens = 0;
      let outputTokens = 0;
      let model = XAI_MODEL;

      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        const response = await fetch(`${XAI_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${key}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: XAI_MODEL,
            max_tokens: MAX_TOKENS,
            messages,
            tools: declared,
          }),
        }).catch(() => {
          throw new HttpError(502, 'ai_failed', 'I could not reach the assistant.');
        });

        if (!response.ok) throw await xaiResponseError(response);

        const body = (await response.json()) as {
          model?: string;
          choices?: Array<{ message?: XaiMessage }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };

        model = body.model ?? XAI_MODEL;
        inputTokens += body.usage?.prompt_tokens ?? 0;
        outputTokens += body.usage?.completion_tokens ?? 0;

        const message = body.choices?.[0]?.message;
        if (!message) throw ranOut();

        messages.push(message);

        const toolCalls = message.tool_calls ?? [];
        if (toolCalls.length === 0) {
          const reply = (message.content ?? '').trim();
          if (!reply) throw ranOut();
          return { reply, toolCalls: called, model, usage: { inputTokens, outputTokens } };
        }

        for (const call of toolCalls) {
          const name = call.function?.name ?? '';
          let input: unknown = {};
          try {
            input = JSON.parse(call.function?.arguments || '{}');
          } catch {
            // Malformed arguments are the model's problem to fix, not a 500.
            input = {};
          }

          called.push({ name, input });
          const output = await tools.run(name, input);
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(output),
          });
        }
      }

      throw ranOut();
    },
  };
}

/* ------------------------------------------------------------------ */

function toHttpError(error: unknown): unknown {
  if (error instanceof HttpError) return error;
  if (error instanceof Anthropic.AuthenticationError) {
    return new HttpError(502, 'ai_key_rejected', 'The Anthropic API key was rejected');
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new HttpError(429, 'ai_rate_limited', 'Too many questions at once — try again shortly');
  }
  if (error instanceof Anthropic.APIError) {
    return new HttpError(502, 'ai_failed', 'I could not answer that just now.');
  }
  return error;
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
    return new HttpError(429, 'ai_rate_limited', 'Too many questions at once — try again shortly');
  }
  return new HttpError(502, 'ai_failed', message || 'I could not answer that just now.');
}
