import type { Order, OrderStatus, PaymentMethod } from './types.js';

/**
 * The order lifecycle, as a table rather than a pile of if-statements:
 *
 *   placed ──▶ accepted ──▶ ready ──▶ completed
 *      │           │          │
 *      └───────────┴──────────┴──▶ cancelled
 *
 * completed and cancelled are terminal. Vendor ring-ups use this same path so
 * counter sales stay visible until the stall finishes them.
 */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  placed: ['accepted', 'cancelled'],
  accepted: ['ready', 'cancelled'],
  ready: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: OrderStatus,
    readonly to: OrderStatus,
  ) {
    super(`Cannot move an order from ${from} to ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export class PaymentRequiredError extends Error {
  constructor() {
    super('An order cannot be completed without a payment method');
    this.name = 'PaymentRequiredError';
  }
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(status: OrderStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** Statuses a vendor still has work to do on. Drives the queue screen. */
export function isOpen(status: OrderStatus): boolean {
  return status === 'placed' || status === 'accepted' || status === 'ready';
}

export interface TransitionOptions {
  /** Server clock, ISO 8601. Never the device's. */
  at: string;
  /** Required when moving to completed. */
  paymentMethod?: PaymentMethod;
}

/**
 * Returns a new order at the requested status with the matching timestamp
 * stamped. Throws rather than returning a result type, because every caller
 * is a route handler that turns the throw into a 409 — there is no branch
 * where an illegal transition is business as usual.
 */
export function transition(
  order: Order,
  to: OrderStatus,
  options: TransitionOptions,
): Order {
  if (!canTransition(order.status, to)) {
    throw new IllegalTransitionError(order.status, to);
  }

  const paymentMethod = options.paymentMethod ?? order.paymentMethod;
  if (to === 'completed' && paymentMethod === null) {
    throw new PaymentRequiredError();
  }

  return {
    ...order,
    status: to,
    paymentMethod,
    acceptedAt: to === 'accepted' ? options.at : order.acceptedAt,
    readyAt: to === 'ready' ? options.at : order.readyAt,
    completedAt: to === 'completed' ? options.at : order.completedAt,
  };
}

/** Human-facing status text, used by both the customer page and the queue. */
export function statusLabel(status: OrderStatus): string {
  switch (status) {
    case 'placed':
      return 'Sent to the stall';
    case 'accepted':
      return 'Cooking';
    case 'ready':
      return 'Ready — come and collect';
    case 'completed':
      return 'Done';
    case 'cancelled':
      return 'Cancelled';
  }
}
