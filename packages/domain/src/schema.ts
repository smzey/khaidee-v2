import { z } from 'zod';

/**
 * Wire contracts, defined once and used three times: Fastify validates
 * requests against them, and both clients derive their types from them. A
 * field can only drift if it drifts everywhere at once.
 */

export const paymentMethodSchema = z.enum(['cash', 'promptpay']);
export const orderSourceSchema = z.enum(['customer', 'vendor']);
export const orderStatusSchema = z.enum([
  'placed',
  'accepted',
  'ready',
  'completed',
  'cancelled',
]);

const cartLineSchema = z.object({
  itemId: z.string().uuid(),
  qty: z.number().int().min(1).max(99),
  /**
   * Chosen options. Note what is absent here as well as from the dish: no
   * prices. The server reprices everything from its own menu.
   */
  optionIds: z.array(z.string().uuid()).max(30).default([]),
});

export const placeOrderSchema = z.object({
  lines: z.array(cartLineSchema).min(1).max(50),
  /**
   * A UUID the browser generates once and reuses on every retry of the same
   * order. Backed by a unique index, so a double tap or a resend on flaky 4G
   * returns the original order instead of creating a second one.
   */
  clientId: z.string().uuid(),
});
export type PlaceOrderBody = z.infer<typeof placeOrderSchema>;

/** A walk-up the vendor taps in, then moves through the same queue as orders. */
export const ringUpSchema = z.object({
  lines: z.array(cartLineSchema).min(1).max(50),
  clientId: z.string().uuid(),
  paymentMethod: paymentMethodSchema,
});
export type RingUpBody = z.infer<typeof ringUpSchema>;

/**
 * Cancelling needs the clientId the browser generated when it placed the
 * order. An order id alone is not proof of ownership.
 */
export const cancelOrderSchema = z.object({
  clientId: z.string().uuid(),
});
export type CancelOrderBody = z.infer<typeof cancelOrderSchema>;

export const completeOrderSchema = z.object({
  paymentMethod: paymentMethodSchema,
});
export type CompleteOrderBody = z.infer<typeof completeOrderSchema>;

/**
 * Slugs live in the QR and in a URL a customer might read aloud, so they are
 * lowercase letters, digits and hyphens only.
 */
export const slugSchema = z
  .string()
  .min(3)
  .max(40)
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    'Use lowercase letters, numbers and hyphens',
  );

export const pinSchema = z
  .string()
  .regex(/^\d{4,8}$/, 'PIN must be 4 to 8 digits');

export const registerVendorSchema = z.object({
  name: z.string().min(1).max(80),
  slug: slugSchema,
  pin: pinSchema,
  /** Optional: a stall may take cash only. */
  promptpayId: z.string().max(40).optional(),
});
export type RegisterVendorBody = z.infer<typeof registerVendorSchema>;

export const vendorSessionSchema = z.object({
  slug: z.string().min(1).max(64),
  pin: pinSchema,
});
export type VendorSessionBody = z.infer<typeof vendorSessionSchema>;

export const pushTokenSchema = z.object({
  token: z
    .string()
    .min(1)
    .max(300)
    .regex(
      /^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]+\]$/,
      'Not an Expo push token',
    ),
  platform: z.enum(['ios', 'android']).nullable().optional(),
});
export type PushTokenBody = z.infer<typeof pushTokenSchema>;

export const categorySchema = z.object({
  id: z.string().uuid(),
  vendorId: z.string().uuid(),
  nameTh: z.string(),
  nameEn: z.string(),
  sortOrder: z.number().int(),
});

export const optionDtoSchema = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid(),
  nameTh: z.string(),
  nameEn: z.string(),
  priceDelta: z.number().int(),
  isAvailable: z.boolean(),
  sortOrder: z.number().int(),
});

export const optionGroupDtoSchema = z.object({
  id: z.string().uuid(),
  menuItemId: z.string().uuid(),
  nameTh: z.string(),
  nameEn: z.string(),
  minSelect: z.number().int().nonnegative(),
  maxSelect: z.number().int().positive(),
  sortOrder: z.number().int(),
  options: z.array(optionDtoSchema),
});

export const menuIngredientSchema = z.object({
  name: z.string(),
  qty: z.number(),
  unit: z.string(),
});

export const menuItemDtoSchema = z.object({
  id: z.string().uuid(),
  vendorId: z.string().uuid(),
  categoryId: z.string().uuid().nullable(),
  nameTh: z.string(),
  nameEn: z.string(),
  price: z.number().int().nonnegative(),
  imageUrl: z.string().nullable(),
  isAvailable: z.boolean(),
  ingredients: z.array(menuIngredientSchema),
  sortOrder: z.number().int(),
  optionGroups: z.array(optionGroupDtoSchema),
});
export type MenuItemDto = z.infer<typeof menuItemDtoSchema>;

export const customerMenuItemDtoSchema = menuItemDtoSchema.omit({
  ingredients: true,
});
export type CustomerMenuItemDto = z.infer<typeof customerMenuItemDtoSchema>;

export const orderLineOptionDtoSchema = z.object({
  optionId: z.string().uuid(),
  nameSnapshot: z.string(),
  priceDelta: z.number().int(),
});

export const orderLineDtoSchema = z.object({
  menuItemId: z.string().uuid(),
  qty: z.number().int().positive(),
  unitPrice: z.number().int().nonnegative(),
  nameSnapshot: z.string(),
  options: z.array(orderLineOptionDtoSchema),
});

export const orderDtoSchema = z.object({
  id: z.string().uuid(),
  vendorId: z.string().uuid(),
  /** On the ticket, so a customer with two orders knows which stall is which. */
  vendorName: z.string(),
  businessDate: z.string(),
  queueNo: z.number().int().positive(),
  status: orderStatusSchema,
  source: orderSourceSchema,
  total: z.number().int().nonnegative(),
  paymentMethod: paymentMethodSchema.nullable(),
  lines: z.array(orderLineDtoSchema),
  placedAt: z.string(),
  acceptedAt: z.string().nullable(),
  readyAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});
export type OrderDto = z.infer<typeof orderDtoSchema>;

export const storefrontDtoSchema = z.object({
  vendor: z.object({
    id: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
    isOpen: z.boolean(),
  }),
  categories: z.array(categorySchema),
  menu: z.array(customerMenuItemDtoSchema),
});
export type StorefrontDto = z.infer<typeof storefrontDtoSchema>;
