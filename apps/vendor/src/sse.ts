/**
 * A Server-Sent Events reader built on streaming fetch.
 *
 * The browser's own EventSource is not usable here for two reasons: React
 * Native does not have one, and the one browsers do have cannot send an
 * Authorization header — which the vendor stream requires. Reading the body
 * ourselves keeps the token in a header where it belongs, instead of putting
 * it in a URL that ends up in access logs.
 *
 * The wire format is four line types (`id:`, `event:`, `data:`, and comments
 * starting `:`), with a blank line terminating each frame. That is little
 * enough to parse directly, and doing so keeps the frame boundary handling
 * honest: chunks arrive split anywhere, including mid-line.
 */

export interface SseFrame {
  id: number;
  event: string;
  data: string;
}

/**
 * Feed it decoded text, get back whole frames. Holds a buffer because a chunk
 * boundary lands wherever TCP decides, frequently in the middle of a JSON
 * payload.
 */
export function createSseParser() {
  let buffer = '';

  return {
    push(chunk: string): SseFrame[] {
      buffer += chunk;
      const frames: SseFrame[] = [];

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const frame = parseBlock(block);
        if (frame) frames.push(frame);
        boundary = buffer.indexOf('\n\n');
      }

      return frames;
    },

    /** Exposed for tests: what is still waiting for its terminator. */
    pending(): string {
      return buffer;
    },
  };
}

function parseBlock(block: string): SseFrame | null {
  let id = 0;
  let event = 'message';
  const dataLines: string[] = [];

  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    // Comment frames are heartbeats keeping proxies from closing the socket.
    if (line === '' || line.startsWith(':')) continue;

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');

    if (field === 'id') id = Number(value) || 0;
    else if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
  }

  if (dataLines.length === 0) return null;
  return { id, event, data: dataLines.join('\n') };
}

/**
 * The fetch that can actually stream a response body.
 *
 * React Native's global fetch is a polyfill that buffers the whole body and
 * never exposes `response.body`, so reading a stream through it is impossible
 * — the reader would fall back to polling on every real phone while working
 * perfectly in a browser, which is exactly the kind of gap that survives
 * testing. `expo/fetch` streams on native and delegates to the platform fetch
 * on web.
 *
 * Resolved lazily and defensively: if the import is unavailable the global is
 * used, and the caller still degrades to polling rather than failing.
 */
function streamingFetch(): typeof fetch {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const expoFetch = require('expo/fetch')?.fetch;
    if (typeof expoFetch === 'function') return expoFetch as typeof fetch;
  } catch {
    /* fall through to the global */
  }
  return fetch;
}

function createChunkDecoder(): ((value: Uint8Array) => string) | null {
  const Decoder = globalThis.TextDecoder;
  if (typeof Decoder !== 'function') return null;

  try {
    const decoder = new Decoder();
    return (value) => decoder.decode(value, { stream: true });
  } catch {
    return null;
  }
}

export interface StreamHandle {
  close(): void;
}

export interface StreamOptions {
  url: string;
  token: string;
  onOpen?(): void;
  onFrame(frame: SseFrame): void;
  /** Called when the stream ends or cannot be opened, with why. */
  onClosed(reason: 'ended' | 'error' | 'unsupported'): void;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

/**
 * Opens the stream and pumps frames until it ends or is aborted.
 *
 * Reports `unsupported` rather than throwing when the runtime's fetch gives no
 * readable body — some React Native builds still use the whatwg polyfill,
 * which buffers instead of streaming. The caller falls back to polling, which
 * is slower but never silently drops an order.
 */
export function openStream(options: StreamOptions): StreamHandle {
  const controller = new AbortController();
  const doFetch = options.fetchImpl ?? streamingFetch();

  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort());
  }

  void (async () => {
    let response: Response;
    try {
      response = await doFetch(options.url, {
        headers: {
          accept: 'text/event-stream',
          authorization: `Bearer ${options.token}`,
        },
        signal: controller.signal,
      });
    } catch {
      options.onClosed('error');
      return;
    }

    if (!response.ok) {
      options.onClosed('error');
      return;
    }

    const body = response.body as ReadableStream<Uint8Array> | null | undefined;
    if (!body || typeof body.getReader !== 'function') {
      options.onClosed('unsupported');
      return;
    }

    const decode = createChunkDecoder();
    if (!decode) {
      options.onClosed('unsupported');
      return;
    }

    options.onOpen?.();

    const reader = body.getReader();
    const parser = createSseParser();

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const frame of parser.push(decode(value))) {
          options.onFrame(frame);
        }
      }
      options.onClosed('ended');
    } catch {
      options.onClosed(controller.signal.aborted ? 'ended' : 'error');
    }
  })();

  return {
    close() {
      controller.abort();
    },
  };
}
