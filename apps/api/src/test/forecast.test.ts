import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Harness, auth, createHarness, uuid } from './harness.js';

let harness: Harness;

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
});

async function sell(
  lines: Array<{ itemId: string; qty?: number; optionIds?: string[] }>,
): Promise<string> {
  const placed = await harness.app.inject({
    method: 'POST',
    url: `/s/${harness.slug}/orders`,
    payload: { clientId: uuid(), lines },
  });
  expect(placed.statusCode, JSON.stringify(placed.json())).toBe(201);
  const id = placed.json().id as string;

  for (const step of ['accept', 'ready']) {
    const moved = await harness.app.inject({
      method: 'POST',
      url: `/vendor/orders/${id}/${step}`,
      headers: auth(harness.token),
    });
    expect(moved.statusCode).toBe(200);
  }

  const completed = await harness.app.inject({
    method: 'POST',
    url: `/vendor/orders/${id}/complete`,
    headers: auth(harness.token),
    payload: { paymentMethod: 'cash' },
  });
  expect(completed.statusCode).toBe(200);

  return id;
}

const padThai = (qty = 1) => ({
  itemId: harness.items['Pad Thai'] as string,
  qty,
  optionIds: [harness.options['Mild'] as string],
});

describe('GET /vendor/forecast/tomorrow', () => {
  it('needs a signed-in stall', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/vendor/forecast/tomorrow',
    });

    expect(response.statusCode).toBe(401);
  });

  it('forecasts tomorrow ingredients from completed sales, recipes, and weather', async () => {
    const recipe = [
      { name: 'Rice noodles', qty: 120, unit: 'g' },
      { name: 'Tamarind sauce', qty: 30, unit: 'ml' },
    ];
    const saved = await harness.app.inject({
      method: 'PATCH',
      url: `/vendor/menu/${harness.items['Pad Thai']}`,
      headers: auth(harness.token),
      payload: { ingredients: recipe },
    });
    expect(saved.statusCode).toBe(200);

    await sell([padThai(2)]);

    const response = await harness.app.inject({
      method: 'GET',
      url: '/vendor/forecast/tomorrow',
      headers: auth(harness.token),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.history).toMatchObject({
      daysWithSales: 1,
      completedOrders: 1,
      averageRevenue: 120,
      projectedRevenue: 102,
      demandMultiplier: 0.85,
    });
    expect(body.weather).toMatchObject({
      location: 'Bangkok',
      summary: 'Rain',
      precipitationProbability: 80,
    });
    expect(body.dishes[0]).toMatchObject({
      name: 'Pad Thai',
      averageQty: 2,
      forecastQty: 1.7,
      hasIngredients: true,
    });
    expect(body.ingredients).toEqual([
      expect.objectContaining({
        name: 'Rice noodles',
        unit: 'g',
        averageQty: 240,
        forecastQty: 204,
        dishes: ['Pad Thai'],
      }),
      expect.objectContaining({
        name: 'Tamarind sauce',
        unit: 'ml',
        averageQty: 60,
        forecastQty: 51,
        dishes: ['Pad Thai'],
      }),
    ]);
    expect(body.missingRecipeDishes).toEqual([]);
  });

  it('points out sold dishes that do not have ingredients yet', async () => {
    await sell([padThai()]);

    const response = await harness.app.inject({
      method: 'GET',
      url: '/vendor/forecast/tomorrow',
      headers: auth(harness.token),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().ingredients).toEqual([]);
    expect(response.json().missingRecipeDishes).toEqual(['Pad Thai']);
  });
});
