import { z } from 'zod';
import { pinSchema } from '@khaidee/domain';

/**
 * Shapes only the vendor side sends. They live here rather than in
 * `@khaidee/domain` because the customer clients never post any of them, and
 * the shared package should carry only what more than one app needs.
 */

export const categoryInputSchema = z.object({
  nameTh: z.string().min(1).max(60),
  nameEn: z.string().min(1).max(60),
  sortOrder: z.number().int().optional(),
});

export const categoryUpdateSchema = z
  .object({
    nameTh: z.string().min(1).max(60).optional(),
    nameEn: z.string().min(1).max(60).optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Send something to update',
  });

export const menuIngredientInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  qty: z.number().min(0).max(1_000_000),
  unit: z.string().trim().max(24),
});

export const menuItemInputSchema = z.object({
  categoryId: z.string().uuid().nullable().optional(),
  nameTh: z.string().min(1).max(80),
  nameEn: z.string().min(1).max(80),
  price: z.number().int().min(0).max(100_000),
  ingredients: z.array(menuIngredientInputSchema).max(50).optional(),
  sortOrder: z.number().int().optional(),
});

export const menuItemUpdateSchema = z
  .object({
    categoryId: z.string().uuid().nullable().optional(),
    nameTh: z.string().min(1).max(80).optional(),
    nameEn: z.string().min(1).max(80).optional(),
    price: z.number().int().min(0).max(100_000).optional(),
    ingredients: z.array(menuIngredientInputSchema).max(50).optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Send something to update',
  });

export const optionGroupInputSchema = z.object({
  nameTh: z.string().min(1).max(60),
  nameEn: z.string().min(1).max(60),
  /** 0 makes the group optional; 1+ makes answering it a condition of ordering. */
  minSelect: z.number().int().min(0).max(20),
  /** 1 renders as radios, more than 1 as checkboxes. */
  maxSelect: z.number().int().min(1).max(20),
  sortOrder: z.number().int().optional(),
  options: z
    .array(
      z.object({
        nameTh: z.string().min(1).max(60),
        nameEn: z.string().min(1).max(60),
        /** Negative is allowed — "no rice" can legitimately take money off. */
        priceDelta: z.number().int().min(-10_000).max(10_000).optional(),
      }),
    )
    .min(1)
    .max(30),
});

export const stallUpdateSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    promptpayId: z.string().max(40).nullable().optional(),
    pin: pinSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Send something to update',
  });

export const promptpayQrSchema = z.object({
  amount: z.number().int().min(1).max(100_000),
});

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Use a real calendar date');

/**
 * A report range. Both ends optional — the common case is a vendor tapping
 * "today" at closing time, which sends nothing at all.
 *
 * The span is capped because every extra day is rows read and, for the written
 * report, tokens paid for. A quarter is more history than a street stall has
 * ever needed to look at in one go.
 */
export const reportRangeSchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    language: z.enum(['th', 'en']).optional(),
  })
  .refine((body) => !(body.from && body.to) || body.from <= body.to, {
    message: 'The range starts after it ends',
  });

/**
 * One question for the assistant, plus as much of the thread as the phone
 * cares to send back. History is client-held — there is no conversation table,
 * because a chat about today's takings is worth nothing tomorrow.
 *
 * The caps are the cost control: a long question and a long thread are both
 * paid for per message, and neither improves the answer.
 */
export const assistantAskSchema = z.object({
  question: z.string().trim().min(1).max(500),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(2000),
      }),
    )
    .max(40)
    .optional(),
});
