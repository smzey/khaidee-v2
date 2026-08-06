import { type OrderDto, isOpen } from '@khaidee/domain';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchToday, streamUrl } from './api';
import { loadLastEventId, saveLastEventId } from './session';
import { type StreamHandle, openStream } from './sse';

/** How often to refetch when the stream is unavailable. */
const POLL_MS = 5_000;
/** How long to wait before trying the stream again after it drops. */
const RETRY_MS = 3_000;
/** How long native fetch gets to prove it can stream before polling takes over. */
const STREAM_OPEN_MS = 2_000;

export type Connection = 'connecting' | 'live' | 'polling' | 'offline';

export interface Queue {
  orders: OrderDto[];
  connection: Connection;
  /** Orders still needing work, newest first — what the screen shows. */
  open: OrderDto[];
  refresh(): Promise<void>;
  apply(order: OrderDto): void;
}

const byQueueNoDesc = (a: OrderDto, b: OrderDto) => b.queueNo - a.queueNo;

/** Replaces the order if it is already known, otherwise adds it. */
export function mergeOrder(orders: OrderDto[], incoming: OrderDto): OrderDto[] {
  const known = orders.some((order) => order.id === incoming.id);
  const next = known
    ? orders.map((order) => (order.id === incoming.id ? incoming : order))
    : [...orders, incoming];
  return next.sort(byQueueNoDesc);
}

export function newPlacedOrders(
  orders: readonly OrderDto[],
  seenIds: Set<string>,
  shouldNotify: boolean,
): OrderDto[] {
  const fresh: OrderDto[] = [];
  for (const order of orders) {
    const isNew = !seenIds.has(order.id);
    seenIds.add(order.id);
    if (shouldNotify && isNew && order.status === 'placed') fresh.push(order);
  }
  return fresh;
}

/**
 * Today's orders, kept current.
 *
 * Three things have to hold at a market stall. A reconnect must replay what
 * was missed, which is why the last event id is persisted and sent back. A
 * runtime without streaming fetch must still work, which is why there is a
 * polling fallback rather than an error. And a dropped connection must be
 * visible to the vendor, which is what `connection` is for — a stall phone
 * that has quietly stopped receiving orders is worse than one that says so.
 */
export function useQueue(
  token: string | null,
  onNewOrder?: (order: OrderDto) => void,
): Queue {
  const [orders, setOrders] = useState<OrderDto[]>([]);
  const [connection, setConnection] = useState<Connection>('connecting');

  const seenIds = useRef(new Set<string>());
  const hasHydrated = useRef(false);
  const streamRef = useRef<StreamHandle | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const alive = useRef(true);

  const apply = useCallback(
    (order: OrderDto) => {
      setOrders((current) => mergeOrder(current, order));
    },
    [],
  );

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const today = await fetchToday(token);
      if (!alive.current) return;
      setOrders(today.sort(byQueueNoDesc));
      const shouldNotify = hasHydrated.current;
      for (const order of newPlacedOrders(today, seenIds.current, shouldNotify)) {
        onNewOrder?.(order);
      }
      hasHydrated.current = true;
    } catch {
      if (alive.current) setConnection('offline');
    }
  }, [token, onNewOrder]);

  useEffect(() => {
    alive.current = true;
    if (!token) return;
    hasHydrated.current = false;

    let polling: ReturnType<typeof setInterval> | null = null;

    const stopPolling = () => {
      if (polling) clearInterval(polling);
      polling = null;
    };

    const startPolling = () => {
      if (polling) return;
      setConnection('polling');
      polling = setInterval(() => void refresh(), POLL_MS);
    };

    const connect = async () => {
      if (!alive.current) return;
      const since = await loadLastEventId();
      if (!alive.current) return;

      let streamOpened = false;
      const openTimer = setTimeout(() => {
        if (!alive.current || streamOpened) return;
        startPolling();
        void refresh();
      }, STREAM_OPEN_MS);
      timers.current.push(openTimer);

      streamRef.current = openStream({
        url: streamUrl(since),
        token,
        onOpen: () => {
          if (!alive.current) return;
          streamOpened = true;
          clearTimeout(openTimer);
          setConnection('live');
          stopPolling();
        },
        onFrame: (frame) => {
          if (!alive.current) return;
          setConnection('live');
          stopPolling();

          let order: OrderDto;
          try {
            order = JSON.parse(frame.data) as OrderDto;
          } catch {
            return; // a malformed frame is not worth dropping the stream over
          }

          // "New" means new to this phone, not merely a `placed` status —
          // otherwise a replay after a reconnect would sound the alert for
          // every order the vendor already dealt with.
          const isNew = !seenIds.current.has(order.id);
          seenIds.current.add(order.id);
          apply(order);
          void saveLastEventId(frame.id);

          if (isNew && order.status === 'placed') onNewOrder?.(order);
        },
        onClosed: (reason) => {
          if (!alive.current) return;
          clearTimeout(openTimer);
          if (reason === 'unsupported') {
            startPolling();
            void refresh();
            return;
          }
          startPolling();
          timers.current.push(setTimeout(() => void connect(), RETRY_MS));
        },
      });
    };

    void refresh().then(() => {
      if (alive.current) void connect();
    });

    return () => {
      alive.current = false;
      streamRef.current?.close();
      stopPolling();
      for (const timer of timers.current) clearTimeout(timer);
      timers.current = [];
    };
  }, [token, refresh, apply, onNewOrder]);

  return {
    orders,
    connection,
    open: orders.filter((order) => isOpen(order.status)),
    refresh,
    apply,
  };
}
