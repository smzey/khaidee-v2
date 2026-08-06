import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Harness, auth, createHarness, uuid } from './harness.js';

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.reset();
});

const place = (
  lines: Array<{ itemId: string; qty: number; optionIds?: string[] }>,
  clientId = uuid(),
) =>
  h.app.inject({
    method: 'POST',
    url: `/s/${h.slug}/orders`,
    payload: { lines, clientId },
  });

const padThai = () => h.items['Pad Thai'] as string;
const mild = () => h.options['Mild'] as string;
const egg = () => h.options['Fried egg'] as string;
const prawns = () => h.options['Prawns'] as string;

describe('the storefront with categories and options', () => {
  it('returns the vendor-defined categories in their arranged order', async () => {
    const res = await h.app.inject({ method: 'GET', url: `/s/${h.slug}` });
    expect(res.json().categories.map((c: { nameEn: string }) => c.nameEn)).toEqual([
      'Noodles',
      'Drinks',
    ]);
  });

  it('puts each dish in its category', async () => {
    const res = await h.app.inject({ method: 'GET', url: `/s/${h.slug}` });
    const menu = res.json().menu;
    const dish = menu.find((m: { nameEn: string }) => m.nameEn === 'Pad Thai');
    expect(dish.categoryId).toBe(h.categories['Noodles']);
  });

  it('carries each dish\'s option groups, with their rules', async () => {
    const res = await h.app.inject({ method: 'GET', url: `/s/${h.slug}` });
    const dish = res
      .json()
      .menu.find((m: { nameEn: string }) => m.nameEn === 'Pad Thai');

    expect(dish.optionGroups).toHaveLength(2);
    const [spice, addons] = dish.optionGroups;
    expect(spice.nameEn).toBe('Spice level');
    expect([spice.minSelect, spice.maxSelect]).toEqual([1, 1]);
    expect([addons.minSelect, addons.maxSelect]).toEqual([0, 3]);
  });

  it('carries each option with its price change', async () => {
    const res = await h.app.inject({ method: 'GET', url: `/s/${h.slug}` });
    const dish = res
      .json()
      .menu.find((m: { nameEn: string }) => m.nameEn === 'Pad Thai');
    const addons = dish.optionGroups[1].options;

    expect(addons.map((o: { nameEn: string; priceDelta: number }) => [o.nameEn, o.priceDelta]))
      .toEqual([
        ['Fried egg', 10],
        ['Prawns', 30],
      ]);
  });

  it('gives a dish with no options an empty group list, not null', async () => {
    const res = await h.app.inject({ method: 'GET', url: `/s/${h.slug}` });
    const water = res
      .json()
      .menu.find((m: { nameEn: string }) => m.nameEn === 'Water');
    expect(water.optionGroups).toEqual([]);
  });

  it('has no picture until one is uploaded', async () => {
    const res = await h.app.inject({ method: 'GET', url: `/s/${h.slug}` });
    expect(res.json().menu[0].imageUrl).toBeNull();
  });
});

describe('pricing an order with options', () => {
  it('charges nothing extra for a free choice', async () => {
    const res = await place([{ itemId: padThai(), qty: 1, optionIds: [mild()] }]);
    expect(res.statusCode).toBe(201);
    expect(res.json().total).toBe(60);
  });

  it('adds the price of each add-on', async () => {
    const res = await place([
      { itemId: padThai(), qty: 1, optionIds: [mild(), egg(), prawns()] },
    ]);
    expect(res.json().total).toBe(100);
  });

  it('multiplies options by the quantity, not just the dish', async () => {
    const res = await place([
      { itemId: padThai(), qty: 3, optionIds: [mild(), egg()] },
    ]);
    expect(res.json().total).toBe(210);
  });

  it('itemises the dish price and the option prices separately', async () => {
    const res = await place([
      { itemId: padThai(), qty: 1, optionIds: [mild(), egg()] },
    ]);
    const [line] = res.json().lines;
    expect(line.unitPrice).toBe(60);
    expect(line.options).toHaveLength(2);
    expect(
      line.options.find((o: { nameSnapshot: string }) => o.nameSnapshot === 'Fried egg')
        .priceDelta,
    ).toBe(10);
  });

  /* The whole reason the server reprices rather than trusting the client. */
  it('ignores any option price the client tries to send', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/s/${h.slug}/orders`,
      payload: {
        clientId: uuid(),
        lines: [
          {
            itemId: padThai(),
            qty: 1,
            optionIds: [mild(), prawns()],
            unitPrice: 1,
            priceDelta: 0,
          },
        ],
      },
    });
    expect(res.json().total).toBe(90);
  });

  it('keeps the same dish with different options as separate lines', async () => {
    const res = await place([
      { itemId: padThai(), qty: 1, optionIds: [mild()] },
      { itemId: padThai(), qty: 1, optionIds: [mild(), egg()] },
    ]);
    expect(res.json().lines).toHaveLength(2);
    expect(res.json().total).toBe(130);
  });

  it('stacks identical picks into one line', async () => {
    const res = await place([
      { itemId: padThai(), qty: 1, optionIds: [mild(), egg()] },
      { itemId: padThai(), qty: 2, optionIds: [egg(), mild()] },
    ]);
    expect(res.json().lines).toHaveLength(1);
    expect(res.json().lines[0].qty).toBe(3);
    expect(res.json().total).toBe(210);
  });
});

describe('option rules are enforced server-side', () => {
  it('refuses a dish whose required group was skipped', async () => {
    const res = await place([{ itemId: padThai(), qty: 1, optionIds: [] }]);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('items_unavailable');
    expect(res.json().details.items[0].reason).toBe('options_invalid');
  });

  it('refuses two choices from a pick-one group', async () => {
    const res = await place([
      {
        itemId: padThai(),
        qty: 1,
        optionIds: [mild(), h.options['Thai hot'] as string],
      },
    ]);
    expect(res.statusCode).toBe(409);
  });

  it('refuses an option that belongs to another dish', async () => {
    const res = await place([
      { itemId: h.items['Water'] as string, qty: 1, optionIds: [mild()] },
    ]);
    expect(res.statusCode).toBe(409);
  });

  it('refuses an option id that does not exist', async () => {
    const res = await place([
      { itemId: padThai(), qty: 1, optionIds: [mild(), uuid()] },
    ]);
    expect(res.statusCode).toBe(409);
  });

  it('accepts a dish that asks nothing, with no options given', async () => {
    const res = await place([{ itemId: h.items['Water'] as string, qty: 1 }]);
    expect(res.statusCode).toBe(201);
    expect(res.json().total).toBe(10);
  });
});

describe('snapshots survive menu edits', () => {
  it('keeps the option name and price the order was placed at', async () => {
    const id = (
      await place([{ itemId: padThai(), qty: 1, optionIds: [mild(), egg()] }])
    ).json().id;

    // The vendor renames and reprices the option after the sale.
    await h.app.inject({
      method: 'POST',
      url: `/vendor/menu/${padThai()}/option-groups`,
      headers: auth(h.token),
      payload: {
        nameTh: 'ใหม่',
        nameEn: 'New group',
        minSelect: 0,
        maxSelect: 1,
        options: [{ nameTh: 'ก', nameEn: 'Something', priceDelta: 99 }],
      },
    });

    const after = await h.app.inject({ method: 'GET', url: `/orders/${id}` });
    const line = after.json().lines[0];
    expect(line.options.map((o: { nameSnapshot: string }) => o.nameSnapshot).sort())
      .toEqual(['Fried egg', 'Mild']);
    expect(after.json().total).toBe(70);
  });
});

describe('the vendor building a menu', () => {
  it('adds a category', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/vendor/categories',
      headers: auth(h.token),
      payload: { nameTh: 'ของหวาน', nameEn: 'Desserts', sortOrder: 5 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().nameEn).toBe('Desserts');
  });

  it('adds a dish into a category', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/vendor/menu',
      headers: auth(h.token),
      payload: {
        categoryId: h.categories['Noodles'],
        nameTh: 'บะหมี่',
        nameEn: 'Egg Noodles',
        price: 55,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().price).toBe(55);
  });

  it('saves dish ingredients for vendor forecasting', async () => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/vendor/menu/${h.items['Pad Thai']}`,
      headers: auth(h.token),
      payload: {
        ingredients: [
          { name: 'Rice noodles', qty: 120, unit: 'g' },
          { name: 'Tamarind sauce', qty: 30, unit: 'ml' },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ingredients).toEqual([
      { name: 'Rice noodles', qty: 120, unit: 'g' },
      { name: 'Tamarind sauce', qty: 30, unit: 'ml' },
    ]);

    const vendorMenu = await h.app.inject({
      method: 'GET',
      url: '/vendor/menu',
      headers: auth(h.token),
    });
    const dish = vendorMenu
      .json()
      .find((item: { nameEn: string }) => item.nameEn === 'Pad Thai');
    expect(dish.ingredients).toHaveLength(2);
  });

  it('does not expose dish ingredients on the customer storefront', async () => {
    await h.app.inject({
      method: 'PATCH',
      url: `/vendor/menu/${h.items['Pad Thai']}`,
      headers: auth(h.token),
      payload: {
        ingredients: [{ name: 'Rice noodles', qty: 120, unit: 'g' }],
      },
    });

    const storefront = await h.app.inject({ method: 'GET', url: `/s/${h.slug}` });
    const dish = storefront
      .json()
      .menu.find((item: { nameEn: string }) => item.nameEn === 'Pad Thai');
    expect(dish.ingredients).toBeUndefined();
  });

  it('edits a category name', async () => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/vendor/categories/${h.categories['Noodles']}`,
      headers: auth(h.token),
      payload: { nameTh: 'เส้น', nameEn: 'Noodle Bar' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().nameEn).toBe('Noodle Bar');
  });

  it('deletes a category without deleting its dishes', async () => {
    const res = await h.app.inject({
      method: 'DELETE',
      url: `/vendor/categories/${h.categories['Noodles']}`,
      headers: auth(h.token),
    });
    expect(res.statusCode).toBe(200);

    const menu = await h.app.inject({ method: 'GET', url: `/s/${h.slug}` });
    const padThai = menu
      .json()
      .menu.find((item: { nameEn: string }) => item.nameEn === 'Pad Thai');
    expect(padThai.categoryId).toBeNull();
  });

  it('edits a dish name, price and category', async () => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/vendor/menu/${h.items['Water']}`,
      headers: auth(h.token),
      payload: {
        categoryId: h.categories['Noodles'],
        nameTh: 'น้ำเย็น',
        nameEn: 'Cold Water',
        price: 12,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().nameEn).toBe('Cold Water');
    expect(res.json().price).toBe(12);
    expect(res.json().categoryId).toBe(h.categories['Noodles']);
  });

  it('archives a dish instead of showing it to customers', async () => {
    const res = await h.app.inject({
      method: 'DELETE',
      url: `/vendor/menu/${h.items['Water']}`,
      headers: auth(h.token),
    });
    expect(res.statusCode).toBe(200);

    const menu = await h.app.inject({ method: 'GET', url: `/s/${h.slug}` });
    expect(
      menu.json().menu.some((item: { nameEn: string }) => item.nameEn === 'Water'),
    ).toBe(false);
  });

  it('adds an option group with its choices in one call', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/vendor/menu/${h.items['Water']}/option-groups`,
      headers: auth(h.token),
      payload: {
        nameTh: 'ขนาด',
        nameEn: 'Size',
        minSelect: 1,
        maxSelect: 1,
        options: [
          { nameTh: 'เล็ก', nameEn: 'Small', priceDelta: 0 },
          { nameTh: 'ใหญ่', nameEn: 'Large', priceDelta: 5 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);

    const menu = await h.app.inject({ method: 'GET', url: `/s/${h.slug}` });
    const water = menu
      .json()
      .menu.find((m: { nameEn: string }) => m.nameEn === 'Water');
    expect(water.optionGroups[0].options).toHaveLength(2);
  });

  it('refuses a group that requires more than it allows', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/vendor/menu/${h.items['Water']}/option-groups`,
      headers: auth(h.token),
      payload: {
        nameTh: 'ก',
        nameEn: 'Impossible',
        minSelect: 3,
        maxSelect: 1,
        options: [{ nameTh: 'ก', nameEn: 'One' }],
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('impossible_group');
  });

  it('refuses a group that requires more than it offers', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/vendor/menu/${h.items['Water']}/option-groups`,
      headers: auth(h.token),
      payload: {
        nameTh: 'ก',
        nameEn: 'Impossible',
        minSelect: 3,
        maxSelect: 3,
        options: [{ nameTh: 'ก', nameEn: 'One' }],
      },
    });
    expect(res.statusCode).toBe(422);
  });

  it('will not let one stall add options to another stall\'s dish', async () => {
    const stolen = h.items['Water'] as string;
    const oldToken = h.token;
    await h.reset();

    const res = await h.app.inject({
      method: 'POST',
      url: `/vendor/menu/${stolen}/option-groups`,
      headers: auth(oldToken),
      payload: {
        nameTh: 'ก',
        nameEn: 'Size',
        minSelect: 0,
        maxSelect: 1,
        options: [{ nameTh: 'ก', nameEn: 'Small' }],
      },
    });
    expect([401, 404]).toContain(res.statusCode);
  });
});
