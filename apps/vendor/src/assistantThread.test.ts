import { consultedLabel, nextMessageId, toHistory } from './assistantThread';
import type { ChatMessage } from './assistantThread';

const message = (over: Partial<ChatMessage> & { role: ChatMessage['role'] }): ChatMessage => ({
  id: nextMessageId(),
  content: 'hello',
  ...over,
});

describe('toHistory', () => {
  it('keeps both sides of the conversation in order', () => {
    const thread = [
      message({ role: 'user', content: 'How did today go?' }),
      message({ role: 'assistant', content: 'You took ฿980.' }),
    ];

    expect(toHistory(thread)).toEqual([
      { role: 'user', content: 'How did today go?' },
      { role: 'assistant', content: 'You took ฿980.' },
    ]);
  });

  it('drops a failed turn, which the model never actually said', () => {
    const thread = [
      message({ role: 'user', content: 'How did today go?' }),
      message({ role: 'assistant', content: 'No connection', failed: true }),
      message({ role: 'user', content: 'again?' }),
    ];

    expect(toHistory(thread).map((turn) => turn.content)).toEqual([
      'How did today go?',
      'again?',
    ]);
  });

  it('carries nothing from an empty thread', () => {
    expect(toHistory([])).toEqual([]);
  });
});

describe('consultedLabel', () => {
  it('names what an answer was read from', () => {
    expect(consultedLabel(['get_report'])).toBe('Read from your figures');
  });

  it('says nothing about checking the date', () => {
    expect(consultedLabel(['get_today'])).toBeNull();
  });

  it('drops the date check but keeps the rest', () => {
    expect(consultedLabel(['get_today', 'get_menu'])).toBe('Read from your menu');
  });

  it('joins two sources', () => {
    expect(consultedLabel(['get_report', 'get_menu'])).toBe(
      'Read from your figures and your menu',
    );
  });

  it('does not repeat a tool called twice', () => {
    expect(consultedLabel(['get_report', 'get_report'])).toBe(
      'Read from your figures',
    );
  });

  it('has nothing to say when no tool was used', () => {
    expect(consultedLabel([])).toBeNull();
  });

  it('ignores a tool name it does not know', () => {
    expect(consultedLabel(['get_profit_margin'])).toBeNull();
  });
});

describe('nextMessageId', () => {
  it('does not repeat within a session', () => {
    const ids = new Set([nextMessageId(), nextMessageId(), nextMessageId()]);
    expect(ids.size).toBe(3);
  });
});
