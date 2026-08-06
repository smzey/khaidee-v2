import { businessDate, type MenuIngredient } from '@khaidee/domain';
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { orderLines, orders, vendors } from '../db/schema.js';
import type { MenuService } from './menu.js';
import { shiftDate } from './reports.js';

type VendorRow = typeof vendors.$inferSelect;

const BANGKOK = { latitude: 13.7563, longitude: 100.5018, name: 'Bangkok' };
const HISTORY_DAYS = 7;

export interface ForecastWeather {
  source: 'open-meteo';
  location: string;
  date: string;
  tempMaxC: number | null;
  tempMinC: number | null;
  precipitationProbability: number | null;
  precipitationMm: number | null;
  weatherCode: number | null;
  summary: string;
}

export interface WeatherClient {
  tomorrow(params: {
    targetDate: string;
    timeZone: string;
  }): Promise<ForecastWeather | null>;
}

interface ForecastLine {
  menuItemId: string;
  qty: number;
  unitPrice: number;
  nameSnapshot: string;
}

export class OpenMeteoWeatherClient implements WeatherClient {
  async tomorrow({
    targetDate,
    timeZone,
  }: {
    targetDate: string;
    timeZone: string;
  }): Promise<ForecastWeather | null> {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(BANGKOK.latitude));
    url.searchParams.set('longitude', String(BANGKOK.longitude));
    url.searchParams.set(
      'daily',
      [
        'weather_code',
        'temperature_2m_max',
        'temperature_2m_min',
        'precipitation_probability_max',
        'precipitation_sum',
      ].join(','),
    );
    url.searchParams.set('timezone', timeZone);
    url.searchParams.set('forecast_days', '3');

    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const body = (await response.json()) as {
        daily?: {
          time?: string[];
          weather_code?: Array<number | null>;
          temperature_2m_max?: Array<number | null>;
          temperature_2m_min?: Array<number | null>;
          precipitation_probability_max?: Array<number | null>;
          precipitation_sum?: Array<number | null>;
        };
      };
      const index = body.daily?.time?.indexOf(targetDate) ?? -1;
      if (index < 0) return null;
      const code = body.daily?.weather_code?.[index] ?? null;
      return {
        source: 'open-meteo',
        location: BANGKOK.name,
        date: targetDate,
        tempMaxC: body.daily?.temperature_2m_max?.[index] ?? null,
        tempMinC: body.daily?.temperature_2m_min?.[index] ?? null,
        precipitationProbability:
          body.daily?.precipitation_probability_max?.[index] ?? null,
        precipitationMm: body.daily?.precipitation_sum?.[index] ?? null,
        weatherCode: code,
        summary: weatherSummary(code),
      };
    } catch {
      return null;
    }
  }
}

export class ForecastService {
  constructor(
    private readonly db: Db,
    private readonly menuService: MenuService,
    private readonly weatherClient: WeatherClient = new OpenMeteoWeatherClient(),
  ) {}

  async tomorrow(vendor: VendorRow) {
    const today = businessDate(new Date(), vendor.timeZone);
    const targetDate = shiftDate(today, 1);
    const from = shiftDate(targetDate, -HISTORY_DAYS);
    const to = today;

    const [menu, lines, dailyRevenue, weather] = await Promise.all([
      this.menuService.menuFor(vendor.id),
      this.completedLines(vendor.id, { from, to }),
      this.dailyRevenue(vendor.id, { from, to }),
      this.weatherClient.tomorrow({ targetDate, timeZone: vendor.timeZone }),
    ]);

    const daysWithSales = dailyRevenue.length;
    const completedOrders = dailyRevenue.reduce((sum, day) => sum + day.orders, 0);
    const revenueTotal = dailyRevenue.reduce((sum, day) => sum + day.revenue, 0);
    const averageRevenue = daysWithSales > 0 ? revenueTotal / daysWithSales : 0;
    const multiplier = weatherMultiplier(weather);
    const projectedRevenue = averageRevenue * multiplier;
    const divisor = Math.max(daysWithSales, 1);
    const menuById = new Map(menu.map((item) => [item.id, item]));
    const dishMap = new Map<
      string,
      {
        menuItemId: string;
        name: string;
        averageQty: number;
        forecastQty: number;
        averageRevenue: number;
        hasIngredients: boolean;
      }
    >();
    const ingredientMap = new Map<
      string,
      {
        key: string;
        name: string;
        unit: string;
        forecastQty: number;
        averageQty: number;
        dishes: string[];
      }
    >();

    const linesByDish = new Map<string, { qty: number; revenue: number; name: string }>();
    for (const line of lines) {
      const found = linesByDish.get(line.menuItemId) ?? {
        qty: 0,
        revenue: 0,
        name: line.nameSnapshot,
      };
      found.qty += line.qty;
      found.revenue += line.qty * line.unitPrice;
      linesByDish.set(line.menuItemId, found);
    }

    for (const [menuItemId, sold] of linesByDish) {
      const item = menuById.get(menuItemId);
      const averageQty = sold.qty / divisor;
      dishMap.set(menuItemId, {
        menuItemId,
        name: item?.nameEn ?? sold.name,
        averageQty,
        forecastQty: averageQty * multiplier,
        averageRevenue: sold.revenue / divisor,
        hasIngredients: (item?.ingredients?.length ?? 0) > 0,
      });
    }
    for (const dish of dishMap.values()) {
      const item = menuById.get(dish.menuItemId);
      for (const ingredient of item?.ingredients ?? []) {
        const clean = cleanIngredient(ingredient);
        if (!clean) continue;
        const key = `${clean.name.toLowerCase()}|${clean.unit.toLowerCase()}`;
        const found = ingredientMap.get(key) ?? {
          key,
          name: clean.name,
          unit: clean.unit,
          forecastQty: 0,
          averageQty: 0,
          dishes: [],
        };
        found.averageQty += clean.qty * dish.averageQty;
        found.forecastQty += clean.qty * dish.forecastQty;
        if (!found.dishes.includes(dish.name)) found.dishes.push(dish.name);
        ingredientMap.set(key, found);
      }
    }

    const byForecast = <T extends { forecastQty: number; name: string }>(a: T, b: T) =>
      b.forecastQty - a.forecastQty || a.name.localeCompare(b.name);

    const notes = forecastNotes(weather, daysWithSales, completedOrders);
    return {
      vendor: { id: vendor.id, name: vendor.name, timeZone: vendor.timeZone },
      targetDate,
      history: {
        from,
        to,
        daysWithSales,
        completedOrders,
        averageRevenue: Math.round(averageRevenue),
        projectedRevenue: Math.round(projectedRevenue),
        demandMultiplier: Number(multiplier.toFixed(2)),
      },
      weather,
      ingredients: [...ingredientMap.values()]
        .map((ingredient) => ({
          ...ingredient,
          averageQty: roundQty(ingredient.averageQty),
          forecastQty: roundQty(ingredient.forecastQty),
          dishes: ingredient.dishes.sort((a, b) => a.localeCompare(b)),
        }))
        .sort(byForecast),
      dishes: [...dishMap.values()]
        .map((dish) => ({
          ...dish,
          averageQty: roundQty(dish.averageQty),
          forecastQty: roundQty(dish.forecastQty),
          averageRevenue: Math.round(dish.averageRevenue),
        }))
        .sort(byForecast),
      missingRecipeDishes: [...dishMap.values()]
        .filter((dish) => !dish.hasIngredients)
        .map((dish) => dish.name)
        .sort((a, b) => a.localeCompare(b)),
      notes,
    };
  }

  private async completedLines(
    vendorId: string,
    range: { from: string; to: string },
  ): Promise<ForecastLine[]> {
    const orderRows = await this.db
      .select({
        id: orders.id,
      })
      .from(orders)
      .where(
        and(
          eq(orders.vendorId, vendorId),
          eq(orders.status, 'completed'),
          gte(orders.businessDate, range.from),
          lte(orders.businessDate, range.to),
        ),
      )
      .orderBy(asc(orders.businessDate));

    if (orderRows.length === 0) return [];
    const lineRows = await this.db
      .select()
      .from(orderLines)
      .where(inArray(orderLines.orderId, orderRows.map((order) => order.id)));

    return lineRows.map((line) => ({
      menuItemId: line.menuItemId,
      qty: line.qty,
      unitPrice: line.unitPrice,
      nameSnapshot: line.nameSnapshot,
    }));
  }

  private async dailyRevenue(vendorId: string, range: { from: string; to: string }) {
    const rows = await this.db
      .select({
        businessDate: orders.businessDate,
        total: orders.total,
      })
      .from(orders)
      .where(
        and(
          eq(orders.vendorId, vendorId),
          eq(orders.status, 'completed'),
          gte(orders.businessDate, range.from),
          lte(orders.businessDate, range.to),
        ),
      );

    const byDay = new Map<string, { businessDate: string; revenue: number; orders: number }>();
    for (const row of rows) {
      const day = byDay.get(row.businessDate) ?? {
        businessDate: row.businessDate,
        revenue: 0,
        orders: 0,
      };
      day.revenue += row.total;
      day.orders += 1;
      byDay.set(row.businessDate, day);
    }
    return [...byDay.values()].sort((a, b) => a.businessDate.localeCompare(b.businessDate));
  }
}

function cleanIngredient(ingredient: MenuIngredient) {
  const name = ingredient.name.trim();
  const unit = ingredient.unit.trim();
  if (!name || !Number.isFinite(ingredient.qty) || ingredient.qty <= 0) return null;
  return { name, unit, qty: ingredient.qty };
}

function roundQty(qty: number): number {
  return Number(qty.toFixed(2));
}

function weatherMultiplier(weather: ForecastWeather | null): number {
  if (!weather) return 1;
  let multiplier = 1;
  const rainChance = weather.precipitationProbability ?? 0;
  const rainMm = weather.precipitationMm ?? 0;
  if (rainChance >= 70 || rainMm >= 10) multiplier *= 0.85;
  else if (rainChance >= 40 || rainMm >= 2) multiplier *= 0.92;
  if ((weather.tempMaxC ?? 0) >= 35) multiplier *= 0.95;
  return multiplier;
}

function forecastNotes(
  weather: ForecastWeather | null,
  daysWithSales: number,
  completedOrders: number,
): string[] {
  const notes: string[] = [];
  if (daysWithSales < 3 || completedOrders < 10) {
    notes.push('Low confidence: not much completed sales history yet.');
  }
  if (!weather) {
    notes.push('Weather unavailable, so no weather adjustment was applied.');
    return notes;
  }
  const rainChance = weather.precipitationProbability ?? 0;
  const rainMm = weather.precipitationMm ?? 0;
  if (rainChance >= 70 || rainMm >= 10) {
    notes.push('Rain risk is high tomorrow, so the forecast trims walk-up demand.');
  } else if (rainChance >= 40 || rainMm >= 2) {
    notes.push('Some rain risk tomorrow, so the forecast is slightly conservative.');
  }
  if ((weather.tempMaxC ?? 0) >= 35) {
    notes.push('Very hot weather can soften food demand and lift drink demand.');
  }
  return notes;
}

function weatherSummary(code: number | null): string {
  if (code === null) return 'Forecast';
  if (code === 0) return 'Clear';
  if ([1, 2, 3].includes(code)) return 'Cloudy';
  if ([45, 48].includes(code)) return 'Fog';
  if ([51, 53, 55, 56, 57].includes(code)) return 'Drizzle';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'Rain';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Snow';
  if ([95, 96, 99].includes(code)) return 'Thunderstorm';
  return 'Forecast';
}
