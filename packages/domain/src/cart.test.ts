import { describe, expect, it } from 'vitest';
import {
  addEntry,
  cartCount,
  cartToLines,
  cartTotal,
  emptyCart,
  entryKey,
  lineTotal,
  qtyOfItem,
  removeEntry,
  setEntryQty,
  unfillable,
  unitPriceOf,
} from './cart.js';
import type { MenuItem, Option, OptionGroup } from './types.js';

const option = (over: Partial<Option> & { id: string }): Option => ({
  groupId: 'g1',
  nameTh: '',
  nameEn: 'Mild',
  priceDelta: 0,
  isAvailable: true,
  sortOrder: 0,
  ...over,
});

const spice: OptionGroup = {
  id: 'g1',
  menuItemId: 'a',
  nameTh: 'ระดับความเผ็ด',
  nameEn: 'Spice level',
  minSelect: 1,
  maxSelect: 1,
  sortOrder: 0,
  options: [
    option({ id: 'mild', nameEn: 'Mild' }),
    option({ id: 'hot', nameEn: 'Thai hot' }),
  ],
};

const addons: OptionGroup = {
  id: 'g2',
  menuItemId: 'a',
  nameTh: 'เพิ่มเติม',
  nameEn: 'Add-ons',
  minSelect: 0,
  maxSelect: 3,
  sortOrder: 1,
  options: [
    option({ id: 'egg', groupId: 'g2', nameEn: 'Extra egg', priceDelta: 10 }),
    option({ id: 'prawns', groupId: 'g2', nameEn: 'Prawns', priceDelta: 30 }),
  ],
};

const padThai: MenuItem = {
  id: 'a',
  vendorId: 'v1',
  categoryId: 'c1',
  nameTh: 'ผัดไทย',
  nameEn: 'Pad Thai',
  price: 60,
  imageUrl: null,
  isAvailable: true,
  ingredients: [],
  sortOrder: 0,
  optionGroups: [spice, addons],
};

const thaiTea: MenuItem = {
  id: 'b',
  vendorId: 'v1',
  categoryId: 'c2',
  nameTh: 'ชาไทย',
  nameEn: 'Thai Tea',
  price: 25,
  imageUrl: null,
  isAvailable: true,
  ingredients: [],
  sortOrder: 1,
  optionGroups: [],
};

const menu = [padThai, thaiTea];

describe('entryKey', () => {
  it('is the same however the options were ordered', () => {
    expect(entryKey('a', ['egg', 'mild'])).toBe(entryKey('a', ['mild', 'egg']));
  });

  it('differs when the options differ', () => {
    expect(entryKey('a', ['mild'])).not.toBe(entryKey('a', ['hot']));
  });

  it('differs when the dish differs', () => {
    expect(entryKey('a', ['mild'])).not.toBe(entryKey('b', ['mild']));
  });
});

describe('building a cart', () => {
  it('starts empty', () => {
    expect(cartCount(emptyCart())).toBe(0);
  });

  it('stacks identical picks into one entry', () => {
    let cart = addEntry(emptyCart(), 'a', ['mild']);
    cart = addEntry(cart, 'a', ['mild']);
    expect(cart).toHaveLength(1);
    expect(cart[0]?.qty).toBe(2);
  });

  /* The reason the cart is a list rather than a map from dish to quantity. */
  it('keeps the same dish with different options as separate entries', () => {
    let cart = addEntry(emptyCart(), 'a', ['mild']);
    cart = addEntry(cart, 'a', ['hot']);
    expect(cart).toHaveLength(2);
    expect(cartCount(cart)).toBe(2);
  });

  it('keeps the same dish with different add-ons apart', () => {
    let cart = addEntry(emptyCart(), 'a', ['mild']);
    cart = addEntry(cart, 'a', ['mild', 'egg']);
    expect(cart).toHaveLength(2);
  });

  it('never mutates the cart it was given', () => {
    const cart = emptyCart();
    addEntry(cart, 'a', ['mild']);
    expect(cart).toEqual([]);
  });

  it('counts one dish across all its option combinations', () => {
    let cart = addEntry(emptyCart(), 'a', ['mild'], 2);
    cart = addEntry(cart, 'a', ['hot']);
    cart = addEntry(cart, 'b');
    expect(qtyOfItem(cart, 'a')).toBe(3);
    expect(qtyOfItem(cart, 'b')).toBe(1);
  });

  it('ignores a non-positive quantity', () => {
    expect(addEntry(emptyCart(), 'a', ['mild'], 0)).toEqual([]);
  });
});

describe('changing quantities', () => {
  const key = entryKey('a', ['mild']);

  it('sets a quantity', () => {
    const cart = setEntryQty(addEntry(emptyCart(), 'a', ['mild']), key, 4);
    expect(cart[0]?.qty).toBe(4);
  });

  it('drops the entry at zero', () => {
    expect(setEntryQty(addEntry(emptyCart(), 'a', ['mild']), key, 0)).toEqual([]);
  });

  it('removes one at a time, dropping the entry at the last', () => {
    let cart = addEntry(emptyCart(), 'a', ['mild'], 2);
    cart = removeEntry(cart, key);
    expect(cart[0]?.qty).toBe(1);
    cart = removeEntry(cart, key);
    expect(cart).toEqual([]);
  });

  it('ignores removing something not in the cart', () => {
    const cart = emptyCart();
    expect(removeEntry(cart, key)).toBe(cart);
  });
});

describe('pricing options', () => {
  it('adds nothing for a free choice', () => {
    const cart = addEntry(emptyCart(), 'a', ['mild']);
    expect(cartTotal(cart, menu)).toBe(60);
  });

  it('adds the price of each add-on', () => {
    const cart = addEntry(emptyCart(), 'a', ['mild', 'egg', 'prawns']);
    expect(cartTotal(cart, menu)).toBe(100);
  });

  it('multiplies options by the quantity, not just the dish', () => {
    const cart = addEntry(emptyCart(), 'a', ['mild', 'egg'], 3);
    // (60 + 10) x 3
    expect(cartTotal(cart, menu)).toBe(210);
  });

  it('keeps the dish price and the option prices separately itemised', () => {
    const cart = addEntry(emptyCart(), 'a', ['mild', 'egg']);
    const [line] = cartToLines(cart, menu);
    expect(line?.unitPrice).toBe(60);
    // Menu order: the required spice choice before the optional add-on.
    expect(line?.options).toEqual([
      { optionId: 'mild', nameSnapshot: 'Mild', priceDelta: 0 },
      { optionId: 'egg', nameSnapshot: 'Extra egg', priceDelta: 10 },
    ]);
    expect(unitPriceOf(line as never)).toBe(70);
    expect(lineTotal(line as never)).toBe(70);
  });

  it('totals a mixed cart', () => {
    let cart = addEntry(emptyCart(), 'a', ['mild', 'prawns']); // 90
    cart = addEntry(cart, 'b', [], 2); // 50
    expect(cartTotal(cart, menu)).toBe(140);
  });

  it('prices a dish with no options at all', () => {
    expect(cartTotal(addEntry(emptyCart(), 'b'), menu)).toBe(25);
  });
});

describe('pricing comes from the menu, never the cart', () => {
  it('reprices when the menu price changes', () => {
    const cart = addEntry(emptyCart(), 'a', ['mild']);
    const dearer = [{ ...padThai, price: 70 }, thaiTea];
    expect(cartTotal(cart, menu)).toBe(60);
    expect(cartTotal(cart, dearer)).toBe(70);
  });

  it('reprices when an option price changes', () => {
    const cart = addEntry(emptyCart(), 'a', ['mild', 'egg']);
    const dearer = [
      {
        ...padThai,
        optionGroups: [
          spice,
          {
            ...addons,
            options: addons.options.map((o) =>
              o.id === 'egg' ? { ...o, priceDelta: 20 } : o,
            ),
          },
        ],
      },
      thaiTea,
    ];
    expect(cartTotal(cart, dearer)).toBe(80);
  });
});

describe('lines the menu cannot fill', () => {
  it('drops a dish that vanished, rather than pricing it at zero', () => {
    const cart = addEntry(emptyCart(), 'ghost', []);
    expect(cartToLines(cart, menu)).toHaveLength(0);
    expect(cartTotal(cart, menu)).toBe(0);
  });

  it('drops a sold-out dish', () => {
    const soldOut = [{ ...padThai, isAvailable: false }, thaiTea];
    let cart = addEntry(emptyCart(), 'a', ['mild']);
    cart = addEntry(cart, 'b');
    expect(cartTotal(cart, soldOut)).toBe(25);
  });

  /* A client that skipped a required group must not get a half-priced dish. */
  it('drops an entry whose options break the rules', () => {
    const cart = addEntry(emptyCart(), 'a', []);
    expect(cartToLines(cart, menu)).toHaveLength(0);
  });

  it('drops an entry using a sold-out option', () => {
    const soldOut = [
      {
        ...padThai,
        optionGroups: [
          spice,
          {
            ...addons,
            options: addons.options.map((o) =>
              o.id === 'prawns' ? { ...o, isAvailable: false } : o,
            ),
          },
        ],
      },
      thaiTea,
    ];
    const cart = addEntry(emptyCart(), 'a', ['mild', 'prawns']);
    expect(cartToLines(cart, soldOut)).toHaveLength(0);
  });
});

describe('unfillable', () => {
  it('is empty when everything can be sold', () => {
    let cart = addEntry(emptyCart(), 'a', ['mild']);
    cart = addEntry(cart, 'b');
    expect(unfillable(cart, menu)).toEqual([]);
  });

  it('names a dish that sold out since the page loaded', () => {
    const soldOut = [{ ...padThai, isAvailable: false }, thaiTea];
    const cart = addEntry(emptyCart(), 'a', ['mild']);
    expect(unfillable(cart, soldOut)).toEqual([
      { key: entryKey('a', ['mild']), itemId: 'a', name: 'Pad Thai', reason: 'sold_out' },
    ]);
  });

  it('reports a dish that left the menu entirely', () => {
    const cart = addEntry(emptyCart(), 'ghost', []);
    expect(unfillable(cart, menu)[0]?.reason).toBe('gone');
  });

  it('reports options that no longer satisfy the rules', () => {
    const cart = addEntry(emptyCart(), 'a', []);
    expect(unfillable(cart, menu)[0]?.reason).toBe('options_invalid');
  });
});

describe('line order', () => {
  it('follows the menu, so the ticket reads the way the grid reads', () => {
    let cart = addEntry(emptyCart(), 'b');
    cart = addEntry(cart, 'a', ['mild']);
    expect(cartToLines(cart, menu).map((line) => line.menuItemId)).toEqual([
      'a',
      'b',
    ]);
  });

  it('is stable between two variants of the same dish', () => {
    let cart = addEntry(emptyCart(), 'a', ['hot']);
    cart = addEntry(cart, 'a', ['mild']);
    const first = cartToLines(cart, menu).map((line) => line.options[0]?.optionId);
    const second = cartToLines(cart, menu).map((line) => line.options[0]?.optionId);
    expect(first).toEqual(second);
  });
});
