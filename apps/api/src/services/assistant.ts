import type { Assistant, AssistantAnswer, AssistantTurn } from '../lib/assistant.js';
import { toolBoxFor } from '../lib/assistantTools.js';
import { HttpError } from '../lib/errors.js';
import type { vendors } from '../db/schema.js';
import type { MenuService } from './menu.js';
import type { OrderService } from './orders.js';
import type { ReportService } from './reports.js';

type VendorRow = typeof vendors.$inferSelect;

/**
 * How much of the conversation goes back to the model.
 *
 * The vendor's phone holds the whole thread; the server only replays the tail.
 * Six exchanges is more than enough for the follow-ups this gets ("and last
 * week?", "which one was that?") and it caps what a long-running bubble can
 * cost per message.
 */
const MAX_HISTORY_TURNS = 12;

export interface AssistantReply extends AssistantAnswer {
  stall: string;
}

export class AssistantService {
  constructor(
    private readonly reports: ReportService,
    private readonly menus: MenuService,
    private readonly orders: OrderService,
    private readonly assistant: Assistant | null = null,
  ) {}

  async ask(params: {
    vendor: VendorRow;
    question: string;
    history: AssistantTurn[];
  }): Promise<AssistantReply> {
    if (!this.assistant) {
      throw new HttpError(
        503,
        'ai_unavailable',
        'The assistant needs an xAI or Anthropic API key. Set XAI_API_KEY or ANTHROPIC_API_KEY.',
      );
    }

    const answer = await this.assistant.ask({
      stallName: params.vendor.name,
      question: params.question,
      history: trimHistory(params.history),
      tools: toolBoxFor({
        vendor: params.vendor,
        reports: this.reports,
        menus: this.menus,
        orders: this.orders,
      }),
    });

    return { ...answer, stall: params.vendor.name };
  }
}

/**
 * Keeps the tail, and drops a leading assistant turn.
 *
 * Both providers reject a history that opens with an assistant message, and
 * slicing the tail of a real conversation lands on one about half the time.
 */
export function trimHistory(history: AssistantTurn[]): AssistantTurn[] {
  const tail = history.slice(-MAX_HISTORY_TURNS);
  const firstUser = tail.findIndex((turn) => turn.role === 'user');
  if (firstUser === -1) return [];
  return firstUser === 0 ? tail : tail.slice(firstUser);
}
