export type VendorId = string;
export type MenuItemId = string;
export type CategoryId = string;
export type OptionId = string;
export type OrderId = string;

export type PaymentMethod = 'cash' | 'promptpay';

/**
 * Where the order came from. Customer orders arrive through the QR page; vendor
 * ring-ups are walk-ups the vendor taps in. Both enter the same queue and land
 * in the same table so the day's takings are one query.
 */
export type OrderSource = 'customer' | 'vendor';

export type OrderStatus =
  | 'placed'
  | 'accepted'
  | 'ready'
  | 'completed'
  | 'cancelled';

export interface Vendor {
  id: VendorId;
  /** What the QR encodes: /s/somchai */
  slug: string;
  name: string;
  /** Closed stalls reject new customer orders. */
  isOpen: boolean;
}

/**
 * The vendor's own grouping — "Noodles", "Grilled", "Drinks". Vendor-defined
 * rather than a fixed food/drink split, because a stall that sells three kinds
 * of noodle needs three headings, not one.
 */
export interface Category {
  id: CategoryId;
  vendorId: VendorId;
  nameTh: string;
  nameEn: string;
  sortOrder: number;
}

/**
 * One choice inside a group. `priceDelta` is added to the dish price and may
 * be zero — "mild" costs nothing, "extra prawns" costs ฿30.
 */
export interface Option {
  id: OptionId;
  groupId: string;
  nameTh: string;
  nameEn: string;
  /** Whole baht, added to the dish price. Zero is normal. */
  priceDelta: number;
  isAvailable: boolean;
  sortOrder: number;
}

/**
 * A question the dish asks. `minSelect`/`maxSelect` carry the rule:
 *
 *   min 1, max 1  — spice level: pick exactly one, required
 *   min 0, max 1  — pick one or none
 *   min 0, max n  — add-ons: pick any
 *   min 2, max 3  — pick two or three
 *
 * Encoding the rule as two numbers rather than a `type` field means the UI
 * renders radios when maxSelect is 1 and checkboxes otherwise, and the server
 * validates with the same two numbers.
 */
export interface OptionGroup {
  id: string;
  menuItemId: MenuItemId;
  nameTh: string;
  nameEn: string;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  options: Option[];
}

export interface MenuIngredient {
  name: string;
  qty: number;
  unit: string;
}

export interface MenuItem {
  id: MenuItemId;
  vendorId: VendorId;
  categoryId: CategoryId | null;
  nameTh: string;
  nameEn: string;
  /** Whole baht, before any options. */
  price: number;
  /** Null shows a designed placeholder tile rather than a broken image. */
  imageUrl: string | null;
  /** Sold out for today. The dish still exists; it just cannot be ordered. */
  isAvailable: boolean;
  /** Vendor-only recipe data used for forecasting. */
  ingredients?: MenuIngredient[];
  sortOrder: number;
  optionGroups: OptionGroup[];
}

/** Snapshotted alongside the line, so a deleted option never rewrites history. */
export interface OrderLineOption {
  optionId: OptionId;
  nameSnapshot: string;
  priceDelta: number;
}

/**
 * A line snapshots the price AND the names it was sold under, so editing the
 * menu tomorrow cannot rewrite what today's receipt said.
 */
export interface OrderLine {
  menuItemId: MenuItemId;
  qty: number;
  /** The dish price alone. Options are priced separately, and itemised. */
  unitPrice: number;
  nameSnapshot: string;
  options: OrderLineOption[];
}

export interface Order {
  id: OrderId;
  vendorId: VendorId;
  vendorName: string;
  /** YYYY-MM-DD in the vendor's timezone. Server-assigned. */
  businessDate: string;
  /** Per vendor, per day, starting at 1. What the vendor calls out. */
  queueNo: number;
  status: OrderStatus;
  source: OrderSource;
  /** Whole baht; always equals sumLines(lines). */
  total: number;
  /** Required before an order may be completed. */
  paymentMethod: PaymentMethod | null;
  lines: OrderLine[];
  placedAt: string;
  acceptedAt: string | null;
  readyAt: string | null;
  completedAt: string | null;
}
