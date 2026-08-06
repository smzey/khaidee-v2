import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const paymentMethodEnum = pgEnum('payment_method', [
  'cash',
  'promptpay',
]);
export const orderSourceEnum = pgEnum('order_source', ['customer', 'vendor']);

/** What the stall pays for. The entitlements live in @khaidee/domain. */
export const vendorTierEnum = pgEnum('vendor_tier', ['free', 'pro', 'premium']);
export const orderStatusEnum = pgEnum('order_status', [
  'placed',
  'accepted',
  'ready',
  'completed',
  'cancelled',
]);

export const vendors = pgTable('vendors', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** What the QR encodes: /s/somchai */
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  /** Vendor sign-in for this build. Hashed, never stored in the clear. */
  pinHash: text('pin_hash').notNull(),
  /**
   * The vendor's own PromptPay mobile number or national ID. Money moves bank
   * to bank into this account; we never touch it. Null means the stall takes
   * cash only, and the collect screen says so.
   */
  promptpayId: text('promptpay_id'),
  timeZone: text('time_zone').notNull().default('Asia/Bangkok'),
  isOpen: boolean('is_open').notNull().default(true),
  /**
   * Everyone starts free. There is no payment gateway yet, so this is set by
   * hand — but the gates read from it now, so the day billing arrives nothing
   * downstream has to change.
   */
  tier: vendorTierEnum('tier').notNull().default('free'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const vendorPushTokens = pgTable(
  'vendor_push_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    platform: text('platform'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('vendor_push_tokens_token_idx').on(table.token),
    index('vendor_push_tokens_vendor_idx').on(table.vendorId),
  ],
);

/**
 * The vendor's own headings — "Noodles", "Grilled", "Drinks". Vendor-defined
 * rather than a fixed food/drink split, because a stall selling three kinds of
 * noodle needs three headings.
 */
export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'cascade' }),
    nameTh: text('name_th').notNull(),
    nameEn: text('name_en').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('categories_vendor_idx').on(table.vendorId, table.sortOrder)],
);

export const menuItems = pgTable(
  'menu_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'cascade' }),
    /** Null is "uncategorised", which the page shows last rather than hiding. */
    categoryId: uuid('category_id').references(() => categories.id, {
      onDelete: 'set null',
    }),
    nameTh: text('name_th').notNull(),
    nameEn: text('name_en').notNull(),
    /** Whole baht, before any options. Never a float. */
    price: integer('price_baht').notNull(),
    /** Null renders a designed placeholder tile, not a broken image. */
    imageUrl: text('image_url'),
    ingredients: jsonb('ingredients')
      .$type<Array<{ name: string; qty: number; unit: string }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    isAvailable: boolean('is_available').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    /**
     * Items are archived, never deleted: an order line points at one, and
     * history must stay readable.
     */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('menu_items_vendor_idx').on(table.vendorId, table.sortOrder),
    check('menu_items_price_nonneg', sql`${table.price} >= 0`),
  ],
);

/**
 * A question a dish asks. The rule lives in two numbers rather than a type
 * field: min 1 / max 1 is "pick exactly one", min 0 / max 3 is "pick up to
 * three". The UI renders radios when maxSelect is 1, and the server validates
 * against the same pair.
 */
export const optionGroups = pgTable(
  'option_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    menuItemId: uuid('menu_item_id')
      .notNull()
      .references(() => menuItems.id, { onDelete: 'cascade' }),
    nameTh: text('name_th').notNull(),
    nameEn: text('name_en').notNull(),
    minSelect: integer('min_select').notNull().default(0),
    maxSelect: integer('max_select').notNull().default(1),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    index('option_groups_item_idx').on(table.menuItemId, table.sortOrder),
    check('option_groups_min_nonneg', sql`${table.minSelect} >= 0`),
    check('option_groups_max_positive', sql`${table.maxSelect} >= 1`),
    /* A group that requires more than it allows can never be satisfied. */
    check(
      'option_groups_min_le_max',
      sql`${table.minSelect} <= ${table.maxSelect}`,
    ),
  ],
);

export const options = pgTable(
  'options',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => optionGroups.id, { onDelete: 'cascade' }),
    nameTh: text('name_th').notNull(),
    nameEn: text('name_en').notNull(),
    /** Added to the dish price. Zero is normal; negatives are allowed. */
    priceDelta: integer('price_delta_baht').notNull().default(0),
    isAvailable: boolean('is_available').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [index('options_group_idx').on(table.groupId, table.sortOrder)],
);

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'cascade' }),
    /**
     * The UUID the client generated. Unique per vendor, so a double tap or a
     * retry on flaky 4G returns the original order rather than making a
     * second one.
     */
    clientId: uuid('client_id').notNull(),
    businessDate: date('business_date').notNull(),
    queueNo: integer('queue_no').notNull(),
    status: orderStatusEnum('status').notNull(),
    source: orderSourceEnum('source').notNull(),
    total: integer('total_baht').notNull(),
    paymentMethod: paymentMethodEnum('payment_method'),
    placedAt: timestamp('placed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    readyAt: timestamp('ready_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('orders_client_id_idx').on(table.vendorId, table.clientId),
    uniqueIndex('orders_queue_no_idx').on(
      table.vendorId,
      table.businessDate,
      table.queueNo,
    ),
    index('orders_vendor_day_idx').on(table.vendorId, table.businessDate),
    /**
     * An unpaid sale cannot be closed by accident. This is a constraint, not
     * a convention, so it holds even if a future route forgets.
     */
    check(
      'orders_completed_needs_payment',
      sql`${table.status} <> 'completed' OR ${table.paymentMethod} IS NOT NULL`,
    ),
    check('orders_total_nonneg', sql`${table.total} >= 0`),
    check('orders_queue_no_positive', sql`${table.queueNo} > 0`),
  ],
);

export const orderLines = pgTable(
  'order_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    menuItemId: uuid('menu_item_id')
      .notNull()
      .references(() => menuItems.id),
    qty: integer('qty').notNull(),
    /** The dish alone. Options are priced on their own rows, and itemised. */
    unitPrice: integer('unit_price_baht').notNull(),
    nameSnapshot: text('name_snapshot').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    index('order_lines_order_idx').on(table.orderId, table.sortOrder),
    check('order_lines_qty_positive', sql`${table.qty} > 0`),
    check('order_lines_price_nonneg', sql`${table.unitPrice} >= 0`),
  ],
);

/**
 * Chosen options, snapshotted with their name and price. The option row may be
 * renamed, repriced or deleted tomorrow; this line still reads correctly.
 */
export const orderLineOptions = pgTable(
  'order_line_options',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderLineId: uuid('order_line_id')
      .notNull()
      .references(() => orderLines.id, { onDelete: 'cascade' }),
    optionId: uuid('option_id').notNull(),
    nameSnapshot: text('name_snapshot').notNull(),
    priceDelta: integer('price_delta_baht').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    index('order_line_options_line_idx').on(table.orderLineId, table.sortOrder),
  ],
);

/**
 * The SSE replay log. A vendor whose signal drops reconnects with
 * Last-Event-ID and gets everything since, so an order can never be missed
 * silently.
 */
export const orderEvents = pgTable(
  'order_events',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('order_events_vendor_idx').on(table.vendorId, table.id)],
);
