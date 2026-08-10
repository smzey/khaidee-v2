import {
  type Cart,
  type OrderDto,
  type OrderLine,
  type OrderSource,
  type OrderStatus,
  type PaymentMethod,
  addEntry,
  businessDate,
  cartToLines,
  daysInRange,
  emptyCart,
  promptPayPayload,
  sumLines,
  transition,
  unfillable,
} from '@khaidee/domain';
import { and, asc, desc, eq, gt, gte, inArray, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  orderEvents,
  orderLineOptions,
  orderLines,
  orders,
  vendors,
} from '../db/schema.js';
import type { EventBroker, OrderEvent } from '../lib/broker.js';
import { HttpError, itemsUnavailable, notFound, stallClosed } from '../lib/errors.js';
import type { MenuService } from './menu.js';

type VendorRow = typeof vendors.$inferSelect;

const iso = (value: Date | null): string | null =>
  value === null ? null : value.toISOString();

const MAX_HISTORY_DAYS = 92;

export interface CartLineInput {
  itemId: string;
  qty: number;
  optionIds?: string[];
}

export class OrderService {
  constructor(
    private readonly db: Db,
    private readonly broker: EventBroker,
    private readonly menuService: MenuService,
  ) {}

  async vendorBySlug(slug: string): Promise<VendorRow> {
    const [vendor] = await this.db
      .select()
      .from(vendors)
      .where(eq(vendors.slug, slug))
      .limit(1);
    if (!vendor) throw notFound('Stall');
    return vendor;
  }

  async vendorById(id: string): Promise<VendorRow> {
    const [vendor] = await this.db
      .select()
      .from(vendors)
      .where(eq(vendors.id, id))
      .limit(1);
    if (!vendor) throw notFound('Stall');
    return vendor;
  }

  /**
   * Prices an order from the SERVER's menu and writes it.
   *
   * The request carries dish ids, quantities and option ids only. Whatever a
   * client believes a Pad Thai or an extra egg costs is not consulted, and the
   * option rules are re-checked here — a client that skips a required group
   * cannot buy a half-specified dish.
   */
  async place(params: {
    vendor: VendorRow;
    lines: CartLineInput[];
    clientId: string;
    source: OrderSource;
    paymentMethod?: PaymentMethod;
  }): Promise<{ order: OrderDto; created: boolean }> {
    const { vendor, lines, clientId, source } = params;

    // A retry of an order we already took is not a new order.
    const existing = await this.findByClientId(vendor.id, clientId);
    if (existing) return { order: existing, created: false };

    if (source === 'customer' && !vendor.isOpen) throw stallClosed();

    const menu = await this.menuService.menuFor(vendor.id);

    let cart: Cart = emptyCart();
    for (const line of lines) {
      cart = addEntry(cart, line.itemId, line.optionIds ?? [], line.qty);
    }

    const problems = unfillable(cart, menu);
    if (problems.length > 0) {
      throw itemsUnavailable(
        problems.map((problem) => ({
          id: problem.itemId,
          name: problem.name,
          reason: problem.reason,
        })),
      );
    }

    const orderLineValues = cartToLines(cart, menu);
    const total = sumLines(orderLineValues);
    const now = new Date();
    const day = businessDate(now, vendor.timeZone);

    const status: OrderStatus = 'placed';

    const inserted = await this.insertWithQueueNo({
      vendorId: vendor.id,
      clientId,
      businessDate: day,
      status,
      source,
      total,
      paymentMethod: params.paymentMethod ?? null,
      placedAt: now,
      completedAt: null,
      lines: orderLineValues,
    });

    if (inserted.raced) {
      // The advisory lock means the winner has committed by now.
      const winner = await this.findByClientId(vendor.id, clientId);
      if (!winner) {
        throw new HttpError(
          409,
          'order_conflict',
          'That order was already taken but cannot be read back',
        );
      }
      return { order: winner, created: false };
    }

    const dto = await this.byId(inserted.id);
    const event = await this.record(vendor.id, dto, 'order.placed');
    this.broker.publish(vendor.id, event);
    return { order: dto, created: true };
  }

  /**
   * Insert the order, its lines and their chosen options in one transaction,
   * allocating the next queue number for the day.
   *
   * A transaction-scoped advisory lock keyed on (vendor, day) serialises the
   * allocation. The obvious alternative — read max(queue_no), insert, retry on
   * conflict — thunders: every simultaneous order reads the same max, one
   * wins, the rest retry into each other, and the last one in a burst can
   * exhaust its retries and fail a customer.
   *
   * It also settles the duplicate-clientId race for free: a double tap blocks
   * on the lock, so by the time the loser proceeds the winner has committed
   * and onConflictDoNothing tells us plainly that we lost.
   */
  private async insertWithQueueNo(params: {
    vendorId: string;
    clientId: string;
    businessDate: string;
    status: OrderStatus;
    source: OrderSource;
    total: number;
    paymentMethod: PaymentMethod | null;
    placedAt: Date;
    completedAt: Date | null;
    lines: OrderLine[];
  }): Promise<{ id: string; raced: boolean }> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`${params.vendorId}:${params.businessDate}`}))`,
      );

      const [{ next } = { next: 1 }] = await tx
        .select({
          next: sql<number>`coalesce(max(${orders.queueNo}), 0) + 1`,
        })
        .from(orders)
        .where(
          and(
            eq(orders.vendorId, params.vendorId),
            eq(orders.businessDate, params.businessDate),
          ),
        );

      const [row] = await tx
        .insert(orders)
        .values({
          vendorId: params.vendorId,
          clientId: params.clientId,
          businessDate: params.businessDate,
          queueNo: Number(next),
          status: params.status,
          source: params.source,
          total: params.total,
          paymentMethod: params.paymentMethod,
          placedAt: params.placedAt,
          completedAt: params.completedAt,
        })
        .onConflictDoNothing({ target: [orders.vendorId, orders.clientId] })
        .returning({ id: orders.id });

      if (!row?.id) return { id: '', raced: true };

      for (const [index, line] of params.lines.entries()) {
        const [lineRow] = await tx
          .insert(orderLines)
          .values({
            orderId: row.id,
            menuItemId: line.menuItemId,
            qty: line.qty,
            unitPrice: line.unitPrice,
            nameSnapshot: line.nameSnapshot,
            sortOrder: index,
          })
          .returning({ id: orderLines.id });

        if (lineRow && line.options.length > 0) {
          await tx.insert(orderLineOptions).values(
            line.options.map((option, optionIndex) => ({
              orderLineId: lineRow.id,
              optionId: option.optionId,
              nameSnapshot: option.nameSnapshot,
              priceDelta: option.priceDelta,
              sortOrder: optionIndex,
            })),
          );
        }
      }

      return { id: row.id, raced: false };
    });
  }

  /** Moves an order along the state machine. The domain decides what is legal. */
  async advance(params: {
    vendorId: string;
    orderId: string;
    to: OrderStatus;
    paymentMethod?: PaymentMethod;
  }): Promise<OrderDto> {
    const current = await this.byId(params.orderId);
    if (current.vendorId !== params.vendorId) throw notFound('Order');

    const at = new Date();
    const next = transition(current, params.to, {
      at: at.toISOString(),
      ...(params.paymentMethod ? { paymentMethod: params.paymentMethod } : {}),
    });

    await this.db
      .update(orders)
      .set({
        status: next.status,
        paymentMethod: next.paymentMethod,
        acceptedAt: next.acceptedAt ? new Date(next.acceptedAt) : null,
        readyAt: next.readyAt ? new Date(next.readyAt) : null,
        completedAt: next.completedAt ? new Date(next.completedAt) : null,
      })
      .where(and(eq(orders.id, params.orderId), eq(orders.status, current.status)));

    const dto = await this.byId(params.orderId);
    const event = await this.record(params.vendorId, dto, 'order.updated');
    this.broker.publish(params.vendorId, event);
    this.broker.publishOrder(dto.id, event);
    return dto;
  }

  async byId(orderId: string): Promise<OrderDto> {
    const [found] = await this.db
      .select({ order: orders, vendorName: vendors.name })
      .from(orders)
      .innerJoin(vendors, eq(vendors.id, orders.vendorId))
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!found) throw notFound('Order');
    const { order: row, vendorName } = found;

    const lineRows = await this.db
      .select()
      .from(orderLines)
      .where(eq(orderLines.orderId, orderId))
      .orderBy(asc(orderLines.sortOrder));

    const optionRows = await this.db
      .select({ option: orderLineOptions })
      .from(orderLineOptions)
      .innerJoin(orderLines, eq(orderLines.id, orderLineOptions.orderLineId))
      .where(eq(orderLines.orderId, orderId))
      .orderBy(asc(orderLineOptions.sortOrder));

    const optionsByLine = new Map<string, OrderLine['options']>();
    for (const { option } of optionRows) {
      const list = optionsByLine.get(option.orderLineId) ?? [];
      list.push({
        optionId: option.optionId,
        nameSnapshot: option.nameSnapshot,
        priceDelta: option.priceDelta,
      });
      optionsByLine.set(option.orderLineId, list);
    }

    return {
      id: row.id,
      vendorId: row.vendorId,
      vendorName,
      businessDate: row.businessDate,
      queueNo: row.queueNo,
      status: row.status,
      source: row.source,
      total: row.total,
      paymentMethod: row.paymentMethod,
      lines: lineRows.map((line) => ({
        menuItemId: line.menuItemId,
        qty: line.qty,
        unitPrice: line.unitPrice,
        nameSnapshot: line.nameSnapshot,
        options: optionsByLine.get(line.id) ?? [],
      })),
      placedAt: row.placedAt.toISOString(),
      acceptedAt: iso(row.acceptedAt),
      readyAt: iso(row.readyAt),
      completedAt: iso(row.completedAt),
    };
  }

  /**
   * A customer cancelling their own order, which they may do only until the
   * stall accepts it. Once the wok is going, the ingredients are spent.
   *
   * The clientId is the proof of ownership: knowing an order id is not enough,
   * because only the browser that placed the order holds its clientId.
   */
  async cancelByCustomer(orderId: string, clientId: string): Promise<OrderDto> {
    const [row] = await this.db
      .select({
        id: orders.id,
        vendorId: orders.vendorId,
        clientId: orders.clientId,
        status: orders.status,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!row || row.clientId !== clientId) throw notFound('Order');

    if (row.status !== 'placed') {
      throw new HttpError(
        409,
        'too_late_to_cancel',
        row.status === 'cancelled'
          ? 'That order was already cancelled'
          : 'The stall has already started on this order',
        { status: row.status },
      );
    }

    return this.advance({ vendorId: row.vendorId, orderId, to: 'cancelled' });
  }

  /**
   * What the collect screen needs: the amount owed and, if the stall has a
   * PromptPay account, a payload for exactly that amount.
   */
  async paymentFor(orderId: string): Promise<{
    total: number;
    promptpayPayload: string | null;
  }> {
    const order = await this.byId(orderId);
    const vendor = await this.vendorById(order.vendorId);

    if (!vendor.promptpayId || order.total <= 0) {
      return { total: order.total, promptpayPayload: null };
    }

    try {
      return {
        total: order.total,
        promptpayPayload: promptPayPayload(vendor.promptpayId, order.total),
      };
    } catch {
      // A malformed PromptPay id must not break the collect screen — the
      // customer can still pay cash.
      return { total: order.total, promptpayPayload: null };
    }
  }

  async setOpen(vendorId: string, isOpen: boolean) {
    const [row] = await this.db
      .update(vendors)
      .set({ isOpen })
      .where(eq(vendors.id, vendorId))
      .returning();
    if (!row) throw notFound('Stall');
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      promptpayId: row.promptpayId,
      isOpen: row.isOpen,
    };
  }

  private async findByClientId(
    vendorId: string,
    clientId: string,
  ): Promise<OrderDto | null> {
    const [row] = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.vendorId, vendorId), eq(orders.clientId, clientId)))
      .limit(1);
    return row ? this.byId(row.id) : null;
  }

  /** Today's orders for the queue screen, newest first. */
  async today(vendorId: string, timeZone: string): Promise<OrderDto[]> {
    const day = businessDate(new Date(), timeZone);
    const rows = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.vendorId, vendorId), eq(orders.businessDate, day)))
      .orderBy(desc(orders.queueNo));
    return Promise.all(rows.map((row) => this.byId(row.id)));
  }

  /**
   * Finished orders for the vendor archive, assembled in three queries so a
   * month of history does not pay the queue screen's per-order read cost.
   */
  async history(
    vendor: VendorRow,
    range: { from: string; to: string },
  ): Promise<OrderDto[]> {
    if (daysInRange(range.from, range.to) > MAX_HISTORY_DAYS) {
      throw new HttpError(
        400,
        'range_too_long',
        `History covers up to ${MAX_HISTORY_DAYS} days at a time`,
      );
    }

    const orderRows = await this.db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.vendorId, vendor.id),
          gte(orders.businessDate, range.from),
          lte(orders.businessDate, range.to),
          inArray(orders.status, ['completed', 'cancelled']),
        ),
      )
      .orderBy(desc(orders.placedAt));

    if (orderRows.length === 0) return [];

    const orderIds = orderRows.map((row) => row.id);

    const lineRows = await this.db
      .select()
      .from(orderLines)
      .where(inArray(orderLines.orderId, orderIds))
      .orderBy(asc(orderLines.sortOrder));

    const optionRows =
      lineRows.length === 0
        ? []
        : await this.db
            .select()
            .from(orderLineOptions)
            .where(
              inArray(
                orderLineOptions.orderLineId,
                lineRows.map((line) => line.id),
              ),
            )
            .orderBy(asc(orderLineOptions.sortOrder));

    const optionsByLine = new Map<string, OrderLine['options']>();
    for (const option of optionRows) {
      const list = optionsByLine.get(option.orderLineId) ?? [];
      list.push({
        optionId: option.optionId,
        nameSnapshot: option.nameSnapshot,
        priceDelta: option.priceDelta,
      });
      optionsByLine.set(option.orderLineId, list);
    }

    const linesByOrder = new Map<string, OrderLine[]>();
    for (const line of lineRows) {
      const list = linesByOrder.get(line.orderId) ?? [];
      list.push({
        menuItemId: line.menuItemId,
        qty: line.qty,
        unitPrice: line.unitPrice,
        nameSnapshot: line.nameSnapshot,
        options: optionsByLine.get(line.id) ?? [],
      });
      linesByOrder.set(line.orderId, list);
    }

    return orderRows.map((row) => ({
      id: row.id,
      vendorId: row.vendorId,
      vendorName: vendor.name,
      businessDate: row.businessDate,
      queueNo: row.queueNo,
      status: row.status,
      source: row.source,
      total: row.total,
      paymentMethod: row.paymentMethod,
      lines: linesByOrder.get(row.id) ?? [],
      placedAt: row.placedAt.toISOString(),
      acceptedAt: iso(row.acceptedAt),
      readyAt: iso(row.readyAt),
      completedAt: iso(row.completedAt),
    }));
  }

  /** Everything a reconnecting vendor missed, in order. */
  async eventsSince(vendorId: string, lastEventId: number): Promise<OrderEvent[]> {
    const rows = await this.db
      .select()
      .from(orderEvents)
      .where(
        and(eq(orderEvents.vendorId, vendorId), gt(orderEvents.id, lastEventId)),
      )
      .orderBy(asc(orderEvents.id))
      .limit(200);

    return Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        type: row.type as OrderEvent['type'],
        order: await this.byId(row.orderId),
      })),
    );
  }

  private async record(
    vendorId: string,
    order: OrderDto,
    type: OrderEvent['type'],
  ): Promise<OrderEvent> {
    const [row] = await this.db
      .insert(orderEvents)
      .values({ vendorId, orderId: order.id, type })
      .returning({ id: orderEvents.id });
    return { id: row?.id ?? 0, type, order };
  }
}
