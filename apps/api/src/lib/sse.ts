import type { OutgoingHttpHeaders } from 'node:http';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { OrderEvent } from './broker.js';

/** Market wifi drops silently; a comment frame every 25s keeps proxies honest. */
const HEARTBEAT_MS = 25_000;
const SHORT_CONNECTION_MS = 5_000;

type SseKind = 'vendor' | 'customer';

interface SseCounters {
  current: number;
  opened: number;
  closed: number;
  sendFailures: number;
}

const counters: Record<SseKind, SseCounters> = {
  vendor: { current: 0, opened: 0, closed: 0, sendFailures: 0 },
  customer: { current: 0, opened: 0, closed: 0, sendFailures: 0 },
};

export interface SseStream {
  send(event: OrderEvent): void;
  onClose(cleanup: () => void): void;
}

export function sseStatsSnapshot(): Record<SseKind, SseCounters> {
  return {
    vendor: { ...counters.vendor },
    customer: { ...counters.customer },
  };
}

export function resetSseStatsForTests(): void {
  counters.vendor = { current: 0, opened: 0, closed: 0, sendFailures: 0 };
  counters.customer = { current: 0, opened: 0, closed: 0, sendFailures: 0 };
}

function streamKind(request: FastifyRequest): SseKind {
  const route = request.routeOptions?.url ?? request.url;
  return route === '/vendor/stream' ? 'vendor' : 'customer';
}

/**
 * Server-Sent Events, hand-rolled because the shape is four lines of text and
 * a library would be more configuration than code.
 *
 * Every frame carries its `id:` — the client sends it back as Last-Event-ID on
 * reconnect, and the server replays from the order_events table, so a vendor
 * who walks behind a concrete pillar never silently misses an order.
 */
export function sseHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): SseStream {
  const kind = streamKind(request);
  const openedAt = Date.now();
  counters[kind].current += 1;
  counters[kind].opened += 1;
  request.log.info(
    {
      requestId: request.id,
      kind,
      route: request.routeOptions?.url ?? request.url,
      lastEventId: lastEventId(request),
      stats: sseStatsSnapshot(),
    },
    'sse stream opened',
  );

  /*
   * Writing to reply.raw goes around Fastify, which means it also goes around
   * the CORS plugin — the browser then blocks the stream because the response
   * carries no Access-Control-Allow-Origin. Carrying over the headers Fastify
   * has already computed keeps whatever CORS policy is configured rather than
   * hardcoding one here.
   */
  const inherited: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(reply.getHeaders())) {
    if (value !== undefined) inherited[name] = value;
  }

  reply.raw.writeHead(200, {
    ...inherited,
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  reply.raw.write(':ok\n\n');

  const heartbeat = setInterval(() => {
    if (!reply.raw.writableEnded) reply.raw.write(':ping\n\n');
  }, HEARTBEAT_MS);

  const cleanups: Array<() => void> = [];
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    counters[kind].current = Math.max(0, counters[kind].current - 1);
    counters[kind].closed += 1;
    const durationMs = Date.now() - openedAt;
    const fields = {
      requestId: request.id,
      kind,
      route: request.routeOptions?.url ?? request.url,
      durationMs,
      stats: sseStatsSnapshot(),
    };
    if (durationMs < SHORT_CONNECTION_MS) {
      request.log.warn(fields, 'sse stream closed quickly');
    } else {
      request.log.info(fields, 'sse stream closed');
    }
    for (const cleanup of cleanups) cleanup();
  };

  request.raw.on('close', close);
  reply.raw.on('close', close);

  return {
    send(event: OrderEvent) {
      if (closed || reply.raw.writableEnded) return;
      try {
        reply.raw.write(
          `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.order)}\n\n`,
        );
      } catch (error) {
        counters[kind].sendFailures += 1;
        request.log.error(
          {
            err: error,
            requestId: request.id,
            kind,
            eventId: event.id,
            eventType: event.type,
            stats: sseStatsSnapshot(),
          },
          'sse send failed',
        );
      }
    },
    onClose(cleanup: () => void) {
      if (closed) cleanup();
      else cleanups.push(cleanup);
    },
  };
}

/** Browsers send Last-Event-ID automatically; a query param helps native clients. */
export function lastEventId(request: FastifyRequest): number {
  const header = request.headers['last-event-id'];
  const query = (request.query as { lastEventId?: string } | undefined)
    ?.lastEventId;
  const raw = (Array.isArray(header) ? header[0] : header) ?? query;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
