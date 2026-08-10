import { EventEmitter } from 'node:events';
import type { OrderDto } from '@khaidee/domain';
import type { LogLike } from './logging.js';

export interface OrderEvent {
  /** Matches order_events.id, so a reconnect can ask for everything after it. */
  id: number;
  type: 'order.placed' | 'order.updated';
  order: OrderDto;
}

/**
 * In-process fan-out to connected SSE clients. Durability lives in the
 * order_events table, not here — this only saves a live listener the latency
 * of a poll. A reconnecting client replays from the table, so losing this on
 * restart costs nothing.
 *
 * Running more than one API instance later means swapping this for Postgres
 * LISTEN/NOTIFY; the interface is small enough that nothing else changes.
 */
export class EventBroker {
  private readonly emitter = new EventEmitter();

  constructor(private readonly options: { logger?: Pick<LogLike, 'warn'> } = {}) {
    // One listener per connected vendor screen; the default cap of 10 is a
    // leak warning, not a limit that suits us.
    this.emitter.setMaxListeners(0);
  }

  publish(vendorId: string, event: OrderEvent): void {
    if (event.type === 'order.placed' && this.subscriberCount(vendorId) === 0) {
      this.options.logger?.warn(
        { vendorId, eventType: event.type },
        'vendor has no live SSE subscribers',
      );
    }
    this.emitter.emit(vendorId, event);
  }

  subscribe(vendorId: string, listener: (event: OrderEvent) => void): () => void {
    this.emitter.on(vendorId, listener);
    return () => this.emitter.off(vendorId, listener);
  }

  subscriberCount(vendorId: string): number {
    return this.emitter.listenerCount(vendorId);
  }

  /** Customer pages watch a single order rather than a whole stall. */
  publishOrder(orderId: string, event: OrderEvent): void {
    this.emitter.emit(`order:${orderId}`, event);
  }

  subscribeOrder(
    orderId: string,
    listener: (event: OrderEvent) => void,
  ): () => void {
    const key = `order:${orderId}`;
    this.emitter.on(key, listener);
    return () => this.emitter.off(key, listener);
  }

  orderSubscriberCount(orderId: string): number {
    return this.emitter.listenerCount(`order:${orderId}`);
  }
}
