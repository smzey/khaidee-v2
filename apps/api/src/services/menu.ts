import type { Category, MenuIngredient, MenuItem, OptionGroup } from '@khaidee/domain';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { categories, menuItems, optionGroups, options } from '../db/schema.js';

/**
 * Assembles the menu — dishes, their option groups, and each group's options —
 * in three queries rather than one per dish. A stall menu is small, so the
 * stitching is cheap and the alternative (a join returning a row per option)
 * costs more to unpick than it saves.
 */
export class MenuService {
  constructor(private readonly db: Db) {}

  async categoriesFor(vendorId: string): Promise<Category[]> {
    const rows = await this.db
      .select()
      .from(categories)
      .where(eq(categories.vendorId, vendorId))
      .orderBy(asc(categories.sortOrder), asc(categories.nameEn));

    return rows.map((row) => ({
      id: row.id,
      vendorId: row.vendorId,
      nameTh: row.nameTh,
      nameEn: row.nameEn,
      sortOrder: row.sortOrder,
    }));
  }

  /** Live menu for a stall: unarchived, in the order the vendor arranged it. */
  async menuFor(vendorId: string): Promise<MenuItem[]> {
    const itemRows = await this.db
      .select()
      .from(menuItems)
      .where(and(eq(menuItems.vendorId, vendorId), isNull(menuItems.archivedAt)))
      .orderBy(asc(menuItems.sortOrder), asc(menuItems.nameEn));

    if (itemRows.length === 0) return [];

    const groupRows = await this.db
      .select({ group: optionGroups })
      .from(optionGroups)
      .innerJoin(menuItems, eq(menuItems.id, optionGroups.menuItemId))
      .where(and(eq(menuItems.vendorId, vendorId), isNull(menuItems.archivedAt)))
      .orderBy(asc(optionGroups.sortOrder), asc(optionGroups.nameEn));

    const optionRows = await this.db
      .select({ option: options })
      .from(options)
      .innerJoin(optionGroups, eq(optionGroups.id, options.groupId))
      .innerJoin(menuItems, eq(menuItems.id, optionGroups.menuItemId))
      .where(and(eq(menuItems.vendorId, vendorId), isNull(menuItems.archivedAt)))
      .orderBy(asc(options.sortOrder), asc(options.nameEn));

    const optionsByGroup = new Map<string, OptionGroup['options']>();
    for (const { option } of optionRows) {
      const list = optionsByGroup.get(option.groupId) ?? [];
      list.push({
        id: option.id,
        groupId: option.groupId,
        nameTh: option.nameTh,
        nameEn: option.nameEn,
        priceDelta: option.priceDelta,
        isAvailable: option.isAvailable,
        sortOrder: option.sortOrder,
      });
      optionsByGroup.set(option.groupId, list);
    }

    const groupsByItem = new Map<string, OptionGroup[]>();
    for (const { group } of groupRows) {
      const list = groupsByItem.get(group.menuItemId) ?? [];
      list.push({
        id: group.id,
        menuItemId: group.menuItemId,
        nameTh: group.nameTh,
        nameEn: group.nameEn,
        minSelect: group.minSelect,
        maxSelect: group.maxSelect,
        sortOrder: group.sortOrder,
        options: optionsByGroup.get(group.id) ?? [],
      });
      groupsByItem.set(group.menuItemId, list);
    }

    return itemRows.map((row) => ({
      id: row.id,
      vendorId: row.vendorId,
      categoryId: row.categoryId,
      nameTh: row.nameTh,
      nameEn: row.nameEn,
      price: row.price,
      imageUrl: row.imageUrl,
      ingredients: normalizeIngredients(row.ingredients),
      isAvailable: row.isAvailable,
      sortOrder: row.sortOrder,
      optionGroups: groupsByItem.get(row.id) ?? [],
    }));
  }
}

function normalizeIngredients(value: unknown): MenuIngredient[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((ingredient) => {
    if (!ingredient || typeof ingredient !== 'object') return [];
    const found = ingredient as { name?: unknown; qty?: unknown; unit?: unknown };
    if (typeof found.name !== 'string' || found.name.trim().length === 0) return [];
    const qty = typeof found.qty === 'number' && Number.isFinite(found.qty) ? found.qty : 0;
    const unit = typeof found.unit === 'string' ? found.unit.trim() : '';
    return [{ name: found.name.trim(), qty, unit }];
  });
}
