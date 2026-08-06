import type { OrderDto } from '@khaidee/domain';
import { mergeOrder, newPlacedOrders } from './useQueue';

const order = (over: Partial<OrderDto> & { id: string; queueNo: number }): OrderDto => ({
  vendorId: 'v1',
  vendorName: 'Test Stall',
  businessDate: '2026-08-06',
  status: 'placed',
  source: 'customer',
  total: 60,
  paymentMethod: null,
  lines: [],
  placedAt: '2026-08-06T04:00:00.000Z',
  acceptedAt: null,
  readyAt: null,
  completedAt: null,
  ...over,
});

describe('newPlacedOrders', () => {
  it('does not notify for the initial queue hydration', () => {
    const seen = new Set<string>();
    const fresh = newPlacedOrders([order({ id: 'a', queueNo: 1 })], seen, false);

    expect(fresh).toEqual([]);
    expect(seen.has('a')).toBe(true);
  });

  it('finds newly polled placed orders after hydration', () => {
    const seen = new Set(['a']);
    const fresh = newPlacedOrders(
      [
        order({ id: 'a', queueNo: 1 }),
        order({ id: 'b', queueNo: 2 }),
        order({ id: 'c', queueNo: 3, status: 'accepted' }),
      ],
      seen,
      true,
    );

    expect(fresh.map((found) => found.id)).toEqual(['b']);
    expect(seen.has('c')).toBe(true);
  });
});

describe('mergeOrder', () => {
  it('adds an order the phone has not seen', () => {
    const merged = mergeOrder([], order({ id: 'a', queueNo: 1 }));
    expect(merged).toHaveLength(1);
  });

  /*
   * The stream replays on reconnect, so the same order arrives more than once.
   * Appending blindly would show the vendor two of every order after every
   * dead spot.
   */
  it('replaces an order it already has rather than duplicating it', () => {
    const before = [order({ id: 'a', queueNo: 1, status: 'placed' })];
    const after = mergeOrder(before, order({ id: 'a', queueNo: 1, status: 'accepted' }));

    expect(after).toHaveLength(1);
    expect(after[0]?.status).toBe('accepted');
  });

  it('puts the newest order at the top, which is where the vendor looks', () => {
    let orders = mergeOrder([], order({ id: 'a', queueNo: 1 }));
    orders = mergeOrder(orders, order({ id: 'c', queueNo: 3 }));
    orders = mergeOrder(orders, order({ id: 'b', queueNo: 2 }));

    expect(orders.map((o) => o.queueNo)).toEqual([3, 2, 1]);
  });

  it('keeps the order in place when only its status changed', () => {
    let orders = mergeOrder([], order({ id: 'a', queueNo: 1 }));
    orders = mergeOrder(orders, order({ id: 'b', queueNo: 2 }));
    orders = mergeOrder(orders, order({ id: 'a', queueNo: 1, status: 'ready' }));

    expect(orders.map((o) => o.queueNo)).toEqual([2, 1]);
    expect(orders[1]?.status).toBe('ready');
  });

  it('does not mutate the list it was given', () => {
    const before = [order({ id: 'a', queueNo: 1 })];
    mergeOrder(before, order({ id: 'b', queueNo: 2 }));
    expect(before).toHaveLength(1);
  });
});
