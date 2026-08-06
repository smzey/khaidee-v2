import type { OutgoingHttpHeaders } from 'node:http';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { OrderEvent } from './broker.js';

/** Market wifi drops silently; a comment frame every 25s keeps proxies honest. */
const HEARTBEAT_MS = 25_000;

export interface SseStream {
  send(event: OrderEvent): void;
  onClose(cleanup: () => void): void;
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
    for (const cleanup of cleanups) cleanup();
  };

  request.raw.on('close', close);
  reply.raw.on('close', close);

  return {
    send(event: OrderEvent) {
      if (closed || reply.raw.writableEnded) return;
      reply.raw.write(
        `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.order)}\n\n`,
      );
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
