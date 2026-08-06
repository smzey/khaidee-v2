import { and, asc, eq, isNull } from 'drizzle-orm';
import { normalizeTarget, type MenuIngredient } from '@khaidee/domain';
import type { Db } from '../db/client.js';
import { categories, menuItems, optionGroups, options, vendors } from '../db/schema.js';
import { hashPin } from '../lib/auth.js';
import { HttpError, notFound } from '../lib/errors.js';

/** Slugs a vendor must not take, because the app already uses them as paths. */
const RESERVED = new Set([
  'admin',
  'api',
  'app',
  'health',
  'khaidee',
  'orders',
  'register',
  's',
  'vendor',
  'www',
]);

export class VendorService {
  constructor(private readonly db: Db) {}

  /**
   * Claims a stall. The slug is the whole identity of the QR, so it is checked
   * against reserved paths and against stalls that already exist — a taken
   * slug is a plain 409 rather than a database error, because the vendor is
   * standing there choosing a name.
   */
  async register(params: {
    name: string;
    slug: string;
    pin: string;
    promptpayId?: string | undefined;
  }) {
    if (RESERVED.has(params.slug)) {
      throw new HttpError(
        409,
        'slug_reserved',
        `"${params.slug}" is reserved. Try another name for the link.`,
      );
    }

    const [taken] = await this.db
      .select({ id: vendors.id })
      .from(vendors)
      .where(eq(vendors.slug, params.slug))
      .limit(1);

    if (taken) {
      throw new HttpError(
        409,
        'slug_taken',
        `"${params.slug}" is already used by another stall. Try another.`,
      );
    }

    const promptpayId = params.promptpayId?.trim();
    if (promptpayId) {
      try {
        normalizeTarget(promptpayId);
      } catch {
        throw new HttpError(
          422,
          'invalid_promptpay',
          'PromptPay must be a Thai mobile number or national ID',
        );
      }
    }

    const [vendor] = await this.db
      .insert(vendors)
      .values({
        name: params.name,
        slug: params.slug,
        pinHash: hashPin(params.pin),
        ...(promptpayId ? { promptpayId } : {}),
      })
      .returning();

    if (!vendor) throw new Error('Vendor insert returned nothing');
    return vendor;
  }

  async addCategory(params: {
    vendorId: string;
    nameTh: string;
    nameEn: string;
    sortOrder?: number | undefined;
  }) {
    const [row] = await this.db
      .insert(categories)
      .values({
        vendorId: params.vendorId,
        nameTh: params.nameTh,
        nameEn: params.nameEn,
        sortOrder: params.sortOrder ?? 0,
      })
      .returning();
    if (!row) throw new Error('Category insert returned nothing');
    return row;
  }

  async updateCategory(params: {
    vendorId: string;
    categoryId: string;
    nameTh?: string | undefined;
    nameEn?: string | undefined;
    sortOrder?: number | undefined;
  }) {
    const values: Partial<typeof categories.$inferInsert> = {};
    if (params.nameTh !== undefined) values.nameTh = params.nameTh;
    if (params.nameEn !== undefined) values.nameEn = params.nameEn;
    if (params.sortOrder !== undefined) values.sortOrder = params.sortOrder;

    const [row] = await this.db
      .update(categories)
      .set(values)
      .where(
        and(
          eq(categories.id, params.categoryId),
          eq(categories.vendorId, params.vendorId),
        ),
      )
      .returning();
    if (!row) throw notFound('Category');
    return row;
  }

  async deleteCategory(vendorId: string, categoryId: string) {
    const [row] = await this.db
      .delete(categories)
      .where(and(eq(categories.id, categoryId), eq(categories.vendorId, vendorId)))
      .returning({ id: categories.id });
    if (!row) throw notFound('Category');
    return { id: row.id };
  }

  async updateStall(params: {
    vendorId: string;
    name?: string | undefined;
    promptpayId?: string | null | undefined;
    pin?: string | undefined;
  }) {
    const values: Partial<typeof vendors.$inferInsert> = {};

    if (params.name !== undefined) values.name = params.name;
    if (params.pin !== undefined) values.pinHash = hashPin(params.pin);

    if (params.promptpayId !== undefined) {
      const trimmed = params.promptpayId?.trim() ?? '';
      if (trimmed) {
        try {
          normalizeTarget(trimmed);
        } catch {
          throw new HttpError(
            422,
            'invalid_promptpay',
            'PromptPay must be a Thai mobile number or national ID',
          );
        }
        values.promptpayId = trimmed;
      } else {
        values.promptpayId = null;
      }
    }

    const [row] = await this.db
      .update(vendors)
      .set(values)
      .where(eq(vendors.id, params.vendorId))
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

  async addMenuItem(params: {
    vendorId: string;
    categoryId?: string | null | undefined;
    nameTh: string;
    nameEn: string;
    price: number;
    ingredients?: MenuIngredient[] | undefined;
    sortOrder?: number | undefined;
  }) {
    const [row] = await this.db
      .insert(menuItems)
      .values({
        vendorId: params.vendorId,
        categoryId: params.categoryId ?? null,
        nameTh: params.nameTh,
        nameEn: params.nameEn,
        price: params.price,
        ingredients: params.ingredients ?? [],
        sortOrder: params.sortOrder ?? 0,
      })
      .returning();
    if (!row) throw new Error('Menu item insert returned nothing');
    return row;
  }

  async updateMenuItem(params: {
    vendorId: string;
    menuItemId: string;
    categoryId?: string | null | undefined;
    nameTh?: string | undefined;
    nameEn?: string | undefined;
    price?: number | undefined;
    ingredients?: MenuIngredient[] | undefined;
    sortOrder?: number | undefined;
  }) {
    if (params.categoryId) {
      await this.assertOwnsCategory(params.vendorId, params.categoryId);
    }

    const values: Partial<typeof menuItems.$inferInsert> = {};
    if (params.categoryId !== undefined) values.categoryId = params.categoryId;
    if (params.nameTh !== undefined) values.nameTh = params.nameTh;
    if (params.nameEn !== undefined) values.nameEn = params.nameEn;
    if (params.price !== undefined) values.price = params.price;
    if (params.ingredients !== undefined) values.ingredients = params.ingredients;
    if (params.sortOrder !== undefined) values.sortOrder = params.sortOrder;

    const [row] = await this.db
      .update(menuItems)
      .set(values)
      .where(
        and(
          eq(menuItems.id, params.menuItemId),
          eq(menuItems.vendorId, params.vendorId),
          isNull(menuItems.archivedAt),
        ),
      )
      .returning();
    if (!row) throw notFound('Menu item');
    return row;
  }

  async archiveMenuItem(vendorId: string, menuItemId: string) {
    const [row] = await this.db
      .update(menuItems)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(menuItems.id, menuItemId),
          eq(menuItems.vendorId, vendorId),
          isNull(menuItems.archivedAt),
        ),
      )
      .returning({ id: menuItems.id });
    if (!row) throw notFound('Menu item');
    return { id: row.id };
  }

  /** Adds a question to a dish, with its choices, in one call. */
  async addOptionGroup(params: {
    vendorId: string;
    menuItemId: string;
    nameTh: string;
    nameEn: string;
    minSelect: number;
    maxSelect: number;
    sortOrder?: number | undefined;
    options: Array<{
      nameTh: string;
      nameEn: string;
      priceDelta?: number | undefined;
    }>;
  }) {
    await this.assertOwnsItem(params.vendorId, params.menuItemId);

    if (params.minSelect > params.maxSelect) {
      throw new HttpError(
        422,
        'impossible_group',
        'A group cannot require more choices than it allows',
      );
    }
    if (params.minSelect > params.options.length) {
      throw new HttpError(
        422,
        'impossible_group',
        'A group cannot require more choices than it offers',
      );
    }

    const [group] = await this.db
      .insert(optionGroups)
      .values({
        menuItemId: params.menuItemId,
        nameTh: params.nameTh,
        nameEn: params.nameEn,
        minSelect: params.minSelect,
        maxSelect: params.maxSelect,
        sortOrder: params.sortOrder ?? 0,
      })
      .returning();

    if (!group) throw new Error('Option group insert returned nothing');

    if (params.options.length > 0) {
      await this.db.insert(options).values(
        params.options.map((option, index) => ({
          groupId: group.id,
          nameTh: option.nameTh,
          nameEn: option.nameEn,
          priceDelta: option.priceDelta ?? 0,
          sortOrder: index,
        })),
      );
    }

    return group;
  }

  /** Sold out, or back on. Returns null if the dish is not this vendor's. */
  async setItemAvailability(
    vendorId: string,
    menuItemId: string,
    isAvailable: boolean,
  ) {
    const [row] = await this.db
      .update(menuItems)
      .set({ isAvailable })
      .where(
        and(
          eq(menuItems.id, menuItemId),
          eq(menuItems.vendorId, vendorId),
          isNull(menuItems.archivedAt),
        ),
      )
      .returning();
    return row ?? null;
  }

  async setImage(vendorId: string, menuItemId: string, imageUrl: string | null) {
    const [row] = await this.db
      .update(menuItems)
      .set({ imageUrl })
      .where(and(eq(menuItems.id, menuItemId), eq(menuItems.vendorId, vendorId)))
      .returning();
    if (!row) throw notFound('Menu item');
    return row;
  }

  private async assertOwnsItem(vendorId: string, menuItemId: string) {
    const [row] = await this.db
      .select({ id: menuItems.id })
      .from(menuItems)
      .where(
        and(eq(menuItems.id, menuItemId), eq(menuItems.vendorId, vendorId)),
      )
      .limit(1);
    if (!row) throw notFound('Menu item');
  }

  private async assertOwnsCategory(vendorId: string, categoryId: string) {
    const [row] = await this.db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, categoryId), eq(categories.vendorId, vendorId)))
      .limit(1);
    if (!row) throw notFound('Category');
  }

  async listCategories(vendorId: string) {
    return this.db
      .select()
      .from(categories)
      .where(eq(categories.vendorId, vendorId))
      .orderBy(asc(categories.sortOrder));
  }
}
