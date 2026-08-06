import type { ReportBrief, Tier } from '@khaidee/domain';
import { sql as drizzleSql, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp, type BuildOptions } from '../app.js';
import { createDb } from '../db/client.js';
import type { NarrateInput, Narration, Narrator } from '../lib/narrator.js';
import {
  categories,
  menuItems,
  optionGroups,
  options,
  vendors,
} from '../db/schema.js';
import { hashPin } from '../lib/auth.js';

/**
 * Integration tests run against a real Postgres, not a mock. The constraints
 * being tested — the queue-number unique index, the completed-needs-payment
 * check, the min<=max group rule — live in the database, so a fake database
 * would test nothing.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/khaidee_test';

export const TEST_PIN = '1234';

export interface Harness {
  app: FastifyInstance;
  vendorId: string;
  slug: string;
  /** Dish ids by English name. */
  items: Record<string, string>;
  /** Option ids by English name. */
  options: Record<string, string>;
  /** Category ids by English name. */
  categories: Record<string, string>;
  token: string;
  /** Moves a stall between plans, for the gating tests. Defaults to the seeded one. */
  setTier(tier: Tier, vendorId?: string): Promise<void>;
  reset(): Promise<void>;
  clearPromptPay(): Promise<void>;
  close(): Promise<void>;
}

/**
 * A narrator that never leaves the process.
 *
 * The suite must not reach Anthropic — not for cost, but because a test that
 * depends on a live model is a test that fails for reasons unrelated to this
 * codebase. It records what it was asked, which is how the tests assert that
 * the model is handed computed facts and nothing else.
 */
export interface StubNarrator extends Narrator {
  calls: NarrateInput[];
  brief: ReportBrief;
  /** Set to make the next write reject, for the error-path tests. */
  failWith: Error | null;
}

export function stubNarrator(): StubNarrator {
  const stub: StubNarrator = {
    calls: [],
    failWith: null,
    brief: {
      headline: 'Steady lunch',
      summary: 'A normal day.',
      wins: ['Pad Thai carried the day'],
      watch: [],
      actions: [
        { action: 'Prep more Pad Thai', because: 'It was most of takings', when: 'tonight' },
      ],
      language: 'th',
    },
    async write(input): Promise<Narration> {
      stub.calls.push(input);
      if (stub.failWith) throw stub.failWith;
      return {
        brief: { ...stub.brief, language: input.language },
        model: 'stub-model',
        usage: { inputTokens: 100, outputTokens: 50 },
      };
    },
  };
  return stub;
}

const defaultWeatherClient: NonNullable<BuildOptions['weatherClient']> = {
  async tomorrow({ targetDate }) {
    return {
      source: 'open-meteo',
      location: 'Bangkok',
      date: targetDate,
      tempMaxC: 34,
      tempMinC: 27,
      precipitationProbability: 80,
      precipitationMm: 12,
      weatherCode: 61,
      summary: 'Rain',
    };
  },
};

export async function createHarness(
  // Not named `options` — that is the drizzle table imported above, and
  // shadowing it silently inserts the config object into the options table.
  config: {
    narrator?: Narrator | null;
    assistant?: BuildOptions['assistant'];
    weatherClient?: BuildOptions['weatherClient'];
  } = {},
): Promise<Harness> {
  const { db, sql } = createDb(TEST_DATABASE_URL);
  // Explicitly null rather than absent, so a developer with a provider key
  // exported does not silently start billing themselves for the test suite.
  const app = buildApp({
    db,
    narrator: config.narrator ?? null,
    assistant: config.assistant ?? null,
    weatherClient: config.weatherClient ?? defaultWeatherClient,
  });
  await app.ready();

  const harness: Harness = {
    app,
    vendorId: '',
    slug: 'teststall',
    items: {},
    options: {},
    categories: {},
    token: '',

    async reset() {
      await db.execute(
        drizzleSql`truncate table order_events, order_line_options, order_lines, orders, options, option_groups, menu_items, categories, vendor_push_tokens, vendors restart identity cascade`,
      );

      const [vendor] = await db
        .insert(vendors)
        .values({
          slug: harness.slug,
          name: 'Test Stall',
          pinHash: hashPin(TEST_PIN),
          promptpayId: '0812345678',
          /*
           * The seeded stall is Premium so the pre-existing suites keep
           * testing what they were written to test. Gating gets its own file,
           * where the tier is set explicitly.
           */
          tier: 'premium',
        })
        .returning();
      if (!vendor) throw new Error('seed vendor failed');
      harness.vendorId = vendor.id;

      const categoryRows = await db
        .insert(categories)
        .values([
          { vendorId: vendor.id, nameTh: 'เส้น', nameEn: 'Noodles', sortOrder: 0 },
          { vendorId: vendor.id, nameTh: 'เครื่องดื่ม', nameEn: 'Drinks', sortOrder: 1 },
        ])
        .returning();
      harness.categories = Object.fromEntries(
        categoryRows.map((row) => [row.nameEn, row.id]),
      );

      const itemRows = await db
        .insert(menuItems)
        .values([
          {
            vendorId: vendor.id,
            categoryId: harness.categories['Noodles'] as string,
            nameTh: 'ผัดไทย',
            nameEn: 'Pad Thai',
            price: 60,
            sortOrder: 0,
          },
          {
            vendorId: vendor.id,
            categoryId: harness.categories['Drinks'] as string,
            nameTh: 'ชาไทย',
            nameEn: 'Thai Tea',
            price: 25,
            sortOrder: 1,
          },
          {
            vendorId: vendor.id,
            categoryId: harness.categories['Drinks'] as string,
            nameTh: 'น้ำเปล่า',
            nameEn: 'Water',
            price: 10,
            sortOrder: 2,
          },
        ])
        .returning();

      harness.items = Object.fromEntries(
        itemRows.map((row) => [row.nameEn, row.id]),
      );

      // Pad Thai asks two questions: spice (pick exactly one, required) and
      // add-ons (pick up to three, optional and priced). Water asks nothing.
      const [spice] = await db
        .insert(optionGroups)
        .values({
          menuItemId: harness.items['Pad Thai'] as string,
          nameTh: 'ระดับความเผ็ด',
          nameEn: 'Spice level',
          minSelect: 1,
          maxSelect: 1,
          sortOrder: 0,
        })
        .returning();

      const [addons] = await db
        .insert(optionGroups)
        .values({
          menuItemId: harness.items['Pad Thai'] as string,
          nameTh: 'เพิ่มเติม',
          nameEn: 'Add-ons',
          minSelect: 0,
          maxSelect: 3,
          sortOrder: 1,
        })
        .returning();

      const optionRows = await db
        .insert(options)
        .values([
          { groupId: spice?.id as string, nameTh: 'เผ็ดน้อย', nameEn: 'Mild', priceDelta: 0, sortOrder: 0 },
          { groupId: spice?.id as string, nameTh: 'เผ็ดมาก', nameEn: 'Thai hot', priceDelta: 0, sortOrder: 1 },
          { groupId: addons?.id as string, nameTh: 'ไข่ดาว', nameEn: 'Fried egg', priceDelta: 10, sortOrder: 0 },
          { groupId: addons?.id as string, nameTh: 'กุ้ง', nameEn: 'Prawns', priceDelta: 30, sortOrder: 1 },
        ])
        .returning();

      harness.options = Object.fromEntries(
        optionRows.map((row) => [row.nameEn, row.id]),
      );

      const login = await app.inject({
        method: 'POST',
        url: '/vendor/session',
        payload: { slug: harness.slug, pin: TEST_PIN },
      });
      harness.token = login.json().token;
    },

    async setTier(tier: Tier, vendorId?: string) {
      await db
        .update(vendors)
        .set({ tier })
        .where(eq(vendors.id, vendorId ?? harness.vendorId));
    },

    async clearPromptPay() {
      await db
        .update(vendors)
        .set({ promptpayId: null })
        .where(eq(vendors.id, harness.vendorId));
    },

    async close() {
      await app.close();
      await sql.end();
    },
  };

  return harness;
}

export const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** Fresh UUID per order; the idempotency key is meant to be client-generated. */
export const uuid = (): string => crypto.randomUUID();
