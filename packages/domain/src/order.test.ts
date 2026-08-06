import { describe, expect, it } from 'vitest';
import {
  IllegalTransitionError,
  PaymentRequiredError,
  canTransition,
  isOpen,
  isTerminal,
  statusLabel,
  transition,
} from './order.js';
import type { Order, OrderStatus } from './types.js';

const AT = '2026-08-05T04:30:00.000Z';

const order = (over: Partial<Order> = {}): Order => ({
  id: 'o1',
  vendorId: 'v1',
  vendorName: 'Test Stall',
  businessDate: '2026-08-05',
  queueNo: 14,
  status: 'placed',
  source: 'customer',
  total: 85,
  paymentMethod: null,
  lines: [
    {
      menuItemId: 'a',
      qty: 1,
      unitPrice: 60,
      nameSnapshot: 'Pad Thai',
      options: [{ optionId: 'mild', nameSnapshot: 'Mild', priceDelta: 0 }],
    },
    { menuItemId: 'b', qty: 1, unitPrice: 25, nameSnapshot: 'Thai Tea', options: [] },
  ],
  placedAt: '2026-08-05T04:00:00.000Z',
  acceptedAt: null,
  readyAt: null,
  completedAt: null,
  ...over,
});

const ALL: OrderStatus[] = [
  'placed',
  'accepted',
  'ready',
  'completed',
  'cancelled',
];

const LEGAL: ReadonlyArray<readonly [OrderStatus, OrderStatus]> = [
  ['placed', 'accepted'],
  ['placed', 'cancelled'],
  ['accepted', 'ready'],
  ['accepted', 'cancelled'],
  ['ready', 'completed'],
  ['ready', 'cancelled'],
];

describe('the transition table', () => {
  it.each(LEGAL)('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it('rejects every pair not in the table', () => {
    const legal = new Set(LEGAL.map(([f, t]) => `${f}>${t}`));
    for (const from of ALL) {
      for (const to of ALL) {
        if (legal.has(`${from}>${to}`)) continue;
        expect(canTransition(from, to), `${from} → ${to}`).toBe(false);
      }
    }
  });

  it('never allows a status to move to itself', () => {
    for (const status of ALL) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it('treats completed and cancelled as terminal, and nothing else', () => {
    expect(ALL.filter(isTerminal)).toEqual(['completed', 'cancelled']);
  });

  it('treats placed, accepted and ready as still open work', () => {
    expect(ALL.filter(isOpen)).toEqual(['placed', 'accepted', 'ready']);
  });
});

describe('transition', () => {
  it('stamps acceptedAt when accepting, and leaves later stamps alone', () => {
    const next = transition(order(), 'accepted', { at: AT });
    expect(next.status).toBe('accepted');
    expect(next.acceptedAt).toBe(AT);
    expect(next.readyAt).toBeNull();
    expect(next.completedAt).toBeNull();
  });

  it('stamps readyAt without disturbing acceptedAt', () => {
    const accepted = transition(order(), 'accepted', { at: AT });
    const ready = transition(accepted, 'ready', {
      at: '2026-08-05T04:35:00.000Z',
    });
    expect(ready.acceptedAt).toBe(AT);
    expect(ready.readyAt).toBe('2026-08-05T04:35:00.000Z');
  });

  it('walks the whole happy path', () => {
    let o = order();
    o = transition(o, 'accepted', { at: AT });
    o = transition(o, 'ready', { at: AT });
    o = transition(o, 'completed', { at: AT, paymentMethod: 'cash' });
    expect(o.status).toBe('completed');
    expect(o.paymentMethod).toBe('cash');
    expect(o.completedAt).toBe(AT);
  });

  it('does not mutate the order it was given', () => {
    const original = order();
    transition(original, 'accepted', { at: AT });
    expect(original.status).toBe('placed');
    expect(original.acceptedAt).toBeNull();
  });

  it('refuses to complete an order with no payment method', () => {
    const ready = order({ status: 'ready' });
    expect(() => transition(ready, 'completed', { at: AT })).toThrow(
      PaymentRequiredError,
    );
  });

  it('completes when the payment method was already set', () => {
    const ready = order({ status: 'ready', paymentMethod: 'promptpay' });
    expect(transition(ready, 'completed', { at: AT }).status).toBe('completed');
  });

  it('refuses to skip straight from placed to ready', () => {
    expect(() => transition(order(), 'ready', { at: AT })).toThrow(
      IllegalTransitionError,
    );
  });

  it('refuses to reopen a completed order', () => {
    const done = order({ status: 'completed', paymentMethod: 'cash' });
    expect(() => transition(done, 'accepted', { at: AT })).toThrow(
      IllegalTransitionError,
    );
  });

  it('refuses to cancel an order already collected', () => {
    const done = order({ status: 'completed', paymentMethod: 'cash' });
    expect(() => transition(done, 'cancelled', { at: AT })).toThrow(
      IllegalTransitionError,
    );
  });

  it('carries the from and to on the error, for the 409 body', () => {
    try {
      transition(order(), 'completed', { at: AT, paymentMethod: 'cash' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalTransitionError);
      expect((error as IllegalTransitionError).from).toBe('placed');
      expect((error as IllegalTransitionError).to).toBe('completed');
    }
  });
});

describe('statusLabel', () => {
  it('has wording for every status', () => {
    for (const status of ALL) {
      expect(statusLabel(status).length).toBeGreaterThan(0);
    }
  });
});
