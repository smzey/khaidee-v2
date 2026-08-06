import { validateSelection } from './options.js';
import type {
  MenuItem,
  MenuItemId,
  OptionId,
  OrderLine,
  OrderLineOption,
} from './types.js';

/**
 * A cart is a list, not a map from dish to quantity.
 *
 * Once dishes carry options, "Pad Thai, extra egg" and "Pad Thai, Thai hot"
 * are two different things at two different prices. Keying by dish id alone
 * would silently merge them and charge the wrong amount, so each distinct
 * combination gets its own entry.
 */
export interface CartEntry {
  /** Dish plus its chosen options, so identical picks stack. */
  key: string;
  itemId: MenuItemId;
  qty: number;
  optionIds: OptionId[];
}

export type Cart = CartEntry[];

export function emptyCart(): Cart {
  return [];
}

/** Sorted, so the same options chosen in a different order produce one entry. */
export function entryKey(
  itemId: MenuItemId,
  optionIds: readonly OptionId[],
): string {
  return [itemId, ...[...optionIds].sort()].join('|');
}

export function addEntry(
  cart: Cart,
  itemId: MenuItemId,
  optionIds: readonly OptionId[] = [],
  qty = 1,
): Cart {
  if (qty <= 0) return cart;
  const key = entryKey(itemId, optionIds);
  const existing = cart.find((entry) => entry.key === key);

  if (existing) {
    return cart.map((entry) =>
      entry.key === key ? { ...entry, qty: entry.qty + qty } : entry,
    );
  }

  return [...cart, { key, itemId, qty, optionIds: [...optionIds].sort() }];
}

export function setEntryQty(cart: Cart, key: string, qty: number): Cart {
  if (qty <= 0) return cart.filter((entry) => entry.key !== key);
  return cart.map((entry) =>
    entry.key === key ? { ...entry, qty: Math.floor(qty) } : entry,
  );
}

export function removeEntry(cart: Cart, key: string): Cart {
  const existing = cart.find((entry) => entry.key === key);
  if (!existing) return cart;
  return setEntryQty(cart, key, existing.qty - 1);
}

export function cartCount(cart: Cart): number {
  return cart.reduce((total, entry) => total + entry.qty, 0);
}

/** How many of a dish are in the cart, across every option combination. */
export function qtyOfItem(cart: Cart, itemId: MenuItemId): number {
  return cart
    .filter((entry) => entry.itemId === itemId)
    .reduce((total, entry) => total + entry.qty, 0);
}

/**
 * Turns a cart into priced lines, in menu order.
 *
 * This is the function the SERVER calls to build an order. The client sends
 * dish ids, quantities and option ids; every price here comes from the menu
 * passed in, never from the request.
 *
 * Entries that cannot be filled are dropped rather than mispriced — call
 * unfillable() first if you need to know why.
 */
export function cartToLines(cart: Cart, menu: readonly MenuItem[]): OrderLine[] {
  const byId = new Map(menu.map((item) => [item.id, item]));
  const order = new Map(menu.map((item, index) => [item.id, index]));

  return cart
    .filter((entry) => {
      const item = byId.get(entry.itemId);
      return (
        item !== undefined &&
        item.isAvailable &&
        entry.qty > 0 &&
        validateSelection(item, entry.optionIds).length === 0
      );
    })
    .sort(
      (a, b) =>
        (order.get(a.itemId) ?? 0) - (order.get(b.itemId) ?? 0) ||
        a.key.localeCompare(b.key),
    )
    .map((entry) => {
      const item = byId.get(entry.itemId) as MenuItem;
      const chosen = new Set(entry.optionIds);

      /*
       * Menu order, not the sorted-id order the key is built from. A ticket
       * should read "Mild · Fried egg" — the required choice first, the way
       * the dish asked — rather than alphabetically by an id nobody sees.
       */
      const options: OrderLineOption[] = item.optionGroups
        .flatMap((group) => group.options)
        .filter((option) => chosen.has(option.id))
        .map((option) => ({
          optionId: option.id,
          nameSnapshot: option.nameEn,
          priceDelta: option.priceDelta,
        }));

      return {
        menuItemId: item.id,
        qty: entry.qty,
        unitPrice: item.price,
        nameSnapshot: item.nameEn,
        options,
      };
    });
}

export function cartTotal(cart: Cart, menu: readonly MenuItem[]): number {
  return sumLines(cartToLines(cart, menu));
}

/** Per-unit price including options — the dish plus everything added to it. */
export function unitPriceOf(line: OrderLine): number {
  return (
    line.unitPrice +
    line.options.reduce((total, option) => total + option.priceDelta, 0)
  );
}

export function lineTotal(line: OrderLine): number {
  return line.qty * unitPriceOf(line);
}

export function sumLines(lines: readonly OrderLine[]): number {
  return lines.reduce((total, line) => total + lineTotal(line), 0);
}

/**
 * What a cart is priced at before it is sent — same arithmetic the server will
 * do, so the bar total and the ticket total cannot disagree.
 */
export function priceEntry(
  entry: CartEntry,
  menu: readonly MenuItem[],
): number {
  return sumLines(cartToLines([entry], menu));
}

export interface UnfillableEntry {
  key: string;
  itemId: MenuItemId;
  /** The dish name, when the menu still knows it. */
  name: string;
  reason: 'gone' | 'sold_out' | 'options_invalid';
}

/**
 * Entries the menu cannot fill right now. The API turns a non-empty result
 * into a 409 naming them, so the customer sees "Pad Thai just sold out" and
 * keeps the rest of their cart.
 */
export function unfillable(
  cart: Cart,
  menu: readonly MenuItem[],
): UnfillableEntry[] {
  const byId = new Map(menu.map((item) => [item.id, item]));

  return cart.flatMap<UnfillableEntry>((entry) => {
    if (entry.qty <= 0) return [];
    const item = byId.get(entry.itemId);
    const base = { key: entry.key, itemId: entry.itemId };

    if (!item) return [{ ...base, name: 'That item', reason: 'gone' }];
    if (!item.isAvailable) return [{ ...base, name: item.nameEn, reason: 'sold_out' }];
    if (validateSelection(item, entry.optionIds).length > 0) {
      return [{ ...base, name: item.nameEn, reason: 'options_invalid' }];
    }
    return [];
  });
}
