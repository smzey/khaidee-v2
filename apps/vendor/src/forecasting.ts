import { isOpen, type MenuItem, type OrderDto } from '@khaidee/domain';

export interface IngredientForecast {
  key: string;
  name: string;
  unit: string;
  openQty: number;
  usedQty: number;
  totalQty: number;
  dishes: string[];
}

export interface DishForecast {
  menuItemId: string;
  name: string;
  openQty: number;
  usedQty: number;
  totalQty: number;
  hasIngredients: boolean;
}

export interface Forecast {
  ingredients: IngredientForecast[];
  dishes: DishForecast[];
  missingRecipeDishes: DishForecast[];
}

const ingredientKey = (name: string, unit: string) =>
  `${name.trim().toLowerCase()}|${unit.trim().toLowerCase()}`;

export function buildForecast(
  menu: readonly MenuItem[],
  orders: readonly OrderDto[],
): Forecast {
  const menuById = new Map(menu.map((item) => [item.id, item]));
  const ingredients = new Map<string, IngredientForecast>();
  const dishes = new Map<string, DishForecast>();

  for (const order of orders) {
    if (order.status === 'cancelled') continue;
    if (!isOpen(order.status) && order.status !== 'completed') continue;

    const bucket: 'openQty' | 'usedQty' = isOpen(order.status) ? 'openQty' : 'usedQty';

    for (const line of order.lines) {
      const menuItem = menuById.get(line.menuItemId);
      const dish = dishes.get(line.menuItemId) ?? {
        menuItemId: line.menuItemId,
        name: menuItem?.nameEn ?? line.nameSnapshot,
        openQty: 0,
        usedQty: 0,
        totalQty: 0,
        hasIngredients: (menuItem?.ingredients?.length ?? 0) > 0,
      };
      dish[bucket] += line.qty;
      dish.totalQty += line.qty;
      dish.hasIngredients = dish.hasIngredients || (menuItem?.ingredients?.length ?? 0) > 0;
      dishes.set(line.menuItemId, dish);

      for (const ingredient of menuItem?.ingredients ?? []) {
        if (!ingredient.name.trim()) continue;
        const key = ingredientKey(ingredient.name, ingredient.unit);
        const found = ingredients.get(key) ?? {
          key,
          name: ingredient.name.trim(),
          unit: ingredient.unit.trim(),
          openQty: 0,
          usedQty: 0,
          totalQty: 0,
          dishes: [],
        };
        const qty = ingredient.qty * line.qty;
        found[bucket] += qty;
        found.totalQty += qty;
        if (!found.dishes.includes(dish.name)) found.dishes.push(dish.name);
        ingredients.set(key, found);
      }
    }
  }

  const byTotalThenName = <T extends { totalQty: number; name: string }>(a: T, b: T) =>
    b.totalQty - a.totalQty || a.name.localeCompare(b.name);

  const dishList = [...dishes.values()].sort(byTotalThenName);

  return {
    ingredients: [...ingredients.values()]
      .map((ingredient) => ({
        ...ingredient,
        dishes: [...ingredient.dishes].sort((a, b) => a.localeCompare(b)),
      }))
      .sort(byTotalThenName),
    dishes: dishList,
    missingRecipeDishes: dishList.filter((dish) => !dish.hasIngredients),
  };
}

export function formatForecastQty(qty: number, unit: string): string {
  const rounded = Number.isInteger(qty) ? String(qty) : qty.toFixed(2).replace(/\.?0+$/, '');
  return unit.trim() ? `${rounded} ${unit.trim()}` : rounded;
}
