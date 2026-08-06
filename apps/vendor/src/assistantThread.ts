import type { AssistantTurn } from './api';

/**
 * The bubble's conversation, kept as plain data so the parts worth being sure
 * about can be tested without mounting a modal.
 */

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** A failed turn stays on screen so the vendor sees what happened. */
  failed?: boolean;
  /** Tool names the answer rested on, for the caption under it. */
  consulted?: string[];
}

/** Openers, because an empty chat box is a worse prompt than three buttons. */
export const SUGGESTIONS = [
  'How did today go?',
  'What sells best?',
  'How busy am I right now?',
  'Was this week better than last week?',
] as const;

/**
 * What goes back to the server.
 *
 * Failed turns are dropped: an error message the vendor saw is not something
 * the model said, and replaying it as if it were teaches it to apologise.
 */
export function toHistory(messages: readonly ChatMessage[]): AssistantTurn[] {
  return messages
    .filter((message) => !message.failed)
    .map((message) => ({ role: message.role, content: message.content }));
}

const TOOL_LABELS: Record<string, string> = {
  get_today: '',
  get_report: "your figures",
  compare_periods: 'two periods side by side',
  get_menu: 'your menu',
  get_queue_now: 'the counter right now',
};

/**
 * A short line saying what the answer was actually read from.
 *
 * This is the bubble's honesty: the vendor can see that a number came from
 * their own orders rather than from the model's imagination. `get_today` is
 * deliberately unlabelled — "checked the date" is noise.
 */
export function consultedLabel(names: readonly string[]): string | null {
  const seen: string[] = [];
  for (const name of names) {
    const label = TOOL_LABELS[name];
    if (label && !seen.includes(label)) seen.push(label);
  }
  if (seen.length === 0) return null;
  if (seen.length === 1) return `Read from ${seen[0]}`;
  return `Read from ${seen.slice(0, -1).join(', ')} and ${seen.at(-1)}`;
}

let counter = 0;
/** Ids only have to be unique within one open sheet. */
export const nextMessageId = (): string => {
  counter += 1;
  return `m${counter}`;
};
