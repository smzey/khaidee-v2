import { createSseParser, openStream } from './sse';

describe('the SSE frame parser', () => {
  it('reads a whole frame', () => {
    const parser = createSseParser();
    const frames = parser.push('id: 7\nevent: order.placed\ndata: {"a":1}\n\n');

    expect(frames).toEqual([
      { id: 7, event: 'order.placed', data: '{"a":1}' },
    ]);
  });

  /*
   * The one that matters: TCP splits chunks wherever it likes, routinely in
   * the middle of a JSON payload. A parser that assumes chunk boundaries are
   * frame boundaries works locally and drops orders on a market connection.
   */
  it('holds a frame split across chunks until it is whole', () => {
    const parser = createSseParser();

    expect(parser.push('id: 7\nevent: order.pla')).toEqual([]);
    expect(parser.push('ced\ndata: {"queue')).toEqual([]);
    expect(parser.push('No":14}\n\n')).toEqual([
      { id: 7, event: 'order.placed', data: '{"queueNo":14}' },
    ]);
  });

  it('reads several frames arriving in one chunk', () => {
    const parser = createSseParser();
    const frames = parser.push(
      'id: 1\nevent: a\ndata: one\n\nid: 2\nevent: b\ndata: two\n\n',
    );

    expect(frames.map((frame) => frame.data)).toEqual(['one', 'two']);
    expect(frames.map((frame) => frame.id)).toEqual([1, 2]);
  });

  it('keeps a trailing partial frame buffered rather than emitting it', () => {
    const parser = createSseParser();
    parser.push('id: 1\ndata: done\n\nid: 2\ndata: half');

    expect(parser.pending()).toBe('id: 2\ndata: half');
  });

  it('ignores heartbeat comments, which keep proxies from hanging up', () => {
    const parser = createSseParser();

    expect(parser.push(':ping\n\n')).toEqual([]);
    expect(parser.push(':ok\n\nid: 3\ndata: real\n\n')).toEqual([
      { id: 3, event: 'message', data: 'real' },
    ]);
  });

  it('tolerates CRLF line endings from a proxy that rewrites them', () => {
    const parser = createSseParser();
    const frames = parser.push('id: 4\r\nevent: x\r\ndata: y\r\n\n');

    expect(frames).toEqual([{ id: 4, event: 'x', data: 'y' }]);
  });

  it('defaults the event name when the server sends only data', () => {
    expect(createSseParser().push('data: bare\n\n')).toEqual([
      { id: 0, event: 'message', data: 'bare' },
    ]);
  });

  it('joins a multi-line data payload with newlines, per the spec', () => {
    expect(createSseParser().push('data: one\ndata: two\n\n')).toEqual([
      { id: 0, event: 'message', data: 'one\ntwo' },
    ]);
  });

  it('drops a frame carrying no data at all', () => {
    expect(createSseParser().push('id: 9\nevent: nothing\n\n')).toEqual([]);
  });

  it('handles a value with no space after the colon', () => {
    expect(createSseParser().push('id:5\ndata:tight\n\n')).toEqual([
      { id: 5, event: 'message', data: 'tight' },
    ]);
  });
});

/** A fetch whose body streams the given chunks, as the real one would. */
function streamingFetch(chunks: string[]) {
  return jest.fn(async () => {
    const encoder = new TextEncoder();
    let index = 0;
    return {
      ok: true,
      body: {
        getReader: () => ({
          read: async () =>
            index < chunks.length
              ? { done: false, value: encoder.encode(chunks[index++]) }
              : { done: true, value: undefined },
        }),
      },
    } as unknown as Response;
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('openStream', () => {
  it('sends the token as a header, which EventSource could not do', async () => {
    const fetchImpl = streamingFetch([]);
    openStream({
      url: 'http://api/vendor/stream',
      token: 'tok123',
      onFrame: () => {},
      onClosed: () => {},
      fetchImpl,
    });
    await settle();

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe(
      'Bearer tok123',
    );
    expect((init.headers as Record<string, string>).accept).toBe(
      'text/event-stream',
    );
  });

  it('delivers frames as they arrive', async () => {
    const frames: string[] = [];
    openStream({
      url: 'http://api/vendor/stream',
      token: 't',
      onFrame: (frame) => frames.push(frame.data),
      onClosed: () => {},
      fetchImpl: streamingFetch(['id: 1\ndata: first\n\n', 'id: 2\ndata: second\n\n']),
    });
    await settle();

    expect(frames).toEqual(['first', 'second']);
  });

  it('reports open once the stream can be read, even before an order arrives', async () => {
    const events: string[] = [];
    openStream({
      url: 'http://api/vendor/stream',
      token: 't',
      onOpen: () => events.push('open'),
      onFrame: () => events.push('frame'),
      onClosed: () => {},
      fetchImpl: streamingFetch([':ok\n\n']),
    });
    await settle();

    expect(events).toEqual(['open']);
  });

  it('reports the stream ending, so the caller can reconnect', async () => {
    const reasons: string[] = [];
    openStream({
      url: 'http://api/vendor/stream',
      token: 't',
      onFrame: () => {},
      onClosed: (reason) => reasons.push(reason),
      fetchImpl: streamingFetch(['id: 1\ndata: x\n\n']),
    });
    await settle();

    expect(reasons).toEqual(['ended']);
  });

  /*
   * Some React Native builds still use the buffering fetch polyfill, which
   * returns no readable body. That must degrade to polling, not to silence.
   */
  it('reports unsupported when the runtime cannot stream a body', async () => {
    const reasons: string[] = [];
    openStream({
      url: 'http://api/vendor/stream',
      token: 't',
      onFrame: () => {},
      onClosed: (reason) => reasons.push(reason),
      fetchImpl: jest.fn(async () => ({ ok: true, body: null }) as unknown as Response),
    });
    await settle();

    expect(reasons).toEqual(['unsupported']);
  });

  it('reports unsupported when the runtime has no TextDecoder', async () => {
    const original = globalThis.TextDecoder;
    Object.defineProperty(globalThis, 'TextDecoder', {
      configurable: true,
      value: undefined,
    });

    const reasons: string[] = [];
    try {
      openStream({
        url: 'http://api/vendor/stream',
        token: 't',
        onFrame: () => {},
        onClosed: (reason) => reasons.push(reason),
        fetchImpl: streamingFetch(['id: 1\ndata: x\n\n']),
      });
      await settle();
    } finally {
      Object.defineProperty(globalThis, 'TextDecoder', {
        configurable: true,
        value: original,
      });
    }

    expect(reasons).toEqual(['unsupported']);
  });

  it('reports an error when the request fails outright', async () => {
    const reasons: string[] = [];
    openStream({
      url: 'http://api/vendor/stream',
      token: 't',
      onFrame: () => {},
      onClosed: (reason) => reasons.push(reason),
      fetchImpl: jest.fn(async () => {
        throw new Error('no network');
      }),
    });
    await settle();

    expect(reasons).toEqual(['error']);
  });

  it('reports an error on a rejected token rather than hanging', async () => {
    const reasons: string[] = [];
    openStream({
      url: 'http://api/vendor/stream',
      token: 'stale',
      onFrame: () => {},
      onClosed: (reason) => reasons.push(reason),
      fetchImpl: jest.fn(async () => ({ ok: false, status: 401 }) as unknown as Response),
    });
    await settle();

    expect(reasons).toEqual(['error']);
  });

  it('stops delivering frames once closed', async () => {
    const frames: string[] = [];
    const handle = openStream({
      url: 'http://api/vendor/stream',
      token: 't',
      onFrame: (frame) => frames.push(frame.data),
      onClosed: () => {},
      fetchImpl: streamingFetch(['id: 1\ndata: x\n\n']),
    });
    handle.close();
    await settle();

    expect(frames.length).toBeLessThanOrEqual(1);
  });
});
