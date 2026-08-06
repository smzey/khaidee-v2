import '@testing-library/dom';

/**
 * Node 25 defines its own `localStorage` global, which shadows the one jsdom
 * installs and does not implement the Storage methods. The app relies on
 * localStorage for the clientId, so tests get a real one here.
 */
class MemoryStorage implements Storage {
  private entries = new Map<string, string>();

  get length() {
    return this.entries.size;
  }
  clear() {
    this.entries.clear();
  }
  getItem(key: string) {
    return this.entries.get(key) ?? null;
  }
  key(index: number) {
    return [...this.entries.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.entries.delete(key);
  }
  setItem(key: string, value: string) {
    this.entries.set(key, String(value));
  }
}

Object.defineProperty(globalThis, 'localStorage', {
  writable: true,
  configurable: true,
  value: new MemoryStorage(),
});

/**
 * jsdom has no EventSource. The screens open one on mount, so tests need a
 * stand-in they can drive: `emit(status)` pushes a frame down the stream
 * exactly as the stall would.
 */
class FakeEventSource {
  static last: FakeEventSource | null = null;
  readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  close() {
    this.closed = true;
  }

  /** Test-side: push a frame as the server would. */
  push(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data: JSON.stringify(data) }));
    }
  }
}

Object.defineProperty(globalThis, 'EventSource', {
  writable: true,
  value: FakeEventSource,
});

export { FakeEventSource };
