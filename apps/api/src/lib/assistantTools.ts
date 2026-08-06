import { businessDate, formatBaht } from '@khaidee/domain';
import type { MenuService } from '../services/menu.js';
import type { OrderService } from '../services/orders.js';
import type { ReportService } from '../services/reports.js';
import type { vendors } from '../db/schema.js';

type VendorRow = typeof vendors.$inferSelect;

/**
 * What the assistant is allowed to know.
 *
 * The model does not receive the stall's data up front and it cannot compute.
 * It receives these tools, and every figure it can possibly say comes back from
 * one of them — which means it came from packages/domain, in whole baht, from
 * real orders. Ask it something no tool covers and it has nothing to say, which
 * is the correct outcome: a POS that confidently states a wrong number is worse
 * than one that admits the gap.
 *
 * Every tool is scoped to the caller's own stall on this side of the wire. The
 * model never supplies a vendorId and could not reach another stall by asking.
 */

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the arguments. Kept flat — nesting confuses tool choice. */
  schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
}

export interface ToolBox {
  specs: ToolSpec[];
  run(name: string, input: unknown): Promise<unknown>;
}

const dateArg = (description: string) => ({
  type: 'string',
  description: `${description} Format YYYY-MM-DD.`,
});

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'get_today',
    description:
      "Today's date on the stall's own clock, plus its timezone. Call this " +
      'before any question about "today", "yesterday", "this week" or "last ' +
      'month" — you have no clock of your own and must not guess the date.',
    schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'get_report',
    description:
      'Every figure for a date range: takings, orders, average order, dish ' +
      'ranking, option attach rates, trade by hour, service times, cash vs ' +
      'PromptPay, QR vs counter, and the movement against the period before. ' +
      'Omit both dates for today. This is the main tool — most questions about ' +
      'money, dishes or busy times are answered from one call.',
    schema: {
      type: 'object',
      properties: {
        from: dateArg('First day of the range, inclusive.'),
        to: dateArg('Last day of the range, inclusive.'),
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'compare_periods',
    description:
      'The same figures for two ranges side by side, for questions like "was ' +
      'this week better than last week?". Prefer get_report when the built-in ' +
      'movement against the previous period already answers the question.',
    schema: {
      type: 'object',
      properties: {
        firstFrom: dateArg('Start of the earlier range.'),
        firstTo: dateArg('End of the earlier range.'),
        secondFrom: dateArg('Start of the later range.'),
        secondTo: dateArg('End of the later range.'),
      },
      required: ['firstFrom', 'firstTo', 'secondFrom', 'secondTo'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_menu',
    description:
      "The stall's current menu: dishes with their prices, whether each is " +
      'available right now, their category, and the option groups with each ' +
      "option's price change. Use for questions about what is sold, what " +
      'things cost, or what is sold out.',
    schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'get_queue_now',
    description:
      "What is on the counter right now: how many orders are waiting, being " +
      'cooked, or ready to collect, and how long the oldest has been waiting. ' +
      'Use for "how busy am I", not for money questions.',
    schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
];

interface Args {
  from?: unknown;
  to?: unknown;
  firstFrom?: unknown;
  firstTo?: unknown;
  secondFrom?: unknown;
  secondTo?: unknown;
}

/** Undefined rather than a bad string, so resolveRange applies its defaults. */
const asDate = (value: unknown): string | undefined =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;

export function toolBoxFor(params: {
  vendor: VendorRow;
  reports: ReportService;
  menus: MenuService;
  orders: OrderService;
}): ToolBox {
  const { vendor, reports, menus, orders } = params;

  const reportFor = async (from: unknown, to: unknown) => {
    const range = reports.resolveRange(vendor, {
      from: asDate(from),
      to: asDate(to),
    });
    const report = await reports.facts(vendor, range);
    return { range: report.range, facts: report.facts };
  };

  return {
    specs: TOOL_SPECS,

    async run(name, rawInput) {
      const input = (rawInput ?? {}) as Args;

      switch (name) {
        case 'get_today':
          return {
            today: businessDate(new Date(), vendor.timeZone),
            timeZone: vendor.timeZone,
            stall: vendor.name,
          };

        case 'get_report':
          return reportFor(input.from, input.to);

        case 'compare_periods': {
          const [first, second] = await Promise.all([
            reportFor(input.firstFrom, input.firstTo),
            reportFor(input.secondFrom, input.secondTo),
          ]);
          return { first, second };
        }

        case 'get_menu': {
          const [categories, menu] = await Promise.all([
            menus.categoriesFor(vendor.id),
            menus.menuFor(vendor.id),
          ]);
          const categoryName = new Map(
            categories.map((category) => [category.id, category.nameEn]),
          );

          return {
            // Trimmed deliberately: ids, image urls and sort orders are noise
            // the model cannot use and would pay input tokens for.
            dishes: menu.map((item) => ({
              name: item.nameEn,
              nameTh: item.nameTh,
              price: item.price,
              priceLabel: formatBaht(item.price),
              available: item.isAvailable,
              category: item.categoryId
                ? (categoryName.get(item.categoryId) ?? null)
                : null,
              optionGroups: item.optionGroups.map((group) => ({
                name: group.nameEn,
                choose: { min: group.minSelect, max: group.maxSelect },
                options: group.options.map((option) => ({
                  name: option.nameEn,
                  priceDelta: option.priceDelta,
                  available: option.isAvailable,
                })),
              })),
            })),
          };
        }

        case 'get_queue_now': {
          const today = await orders.today(vendor.id, vendor.timeZone);
          const now = Date.now();
          const open = today.filter(
            (order) =>
              order.status === 'placed' ||
              order.status === 'accepted' ||
              order.status === 'ready',
          );
          const waits = open.map((order) =>
            Math.floor((now - Date.parse(order.placedAt)) / 60_000),
          );

          return {
            waitingToAccept: today.filter((o) => o.status === 'placed').length,
            cooking: today.filter((o) => o.status === 'accepted').length,
            readyToCollect: today.filter((o) => o.status === 'ready').length,
            completedToday: today.filter((o) => o.status === 'completed').length,
            oldestOpenMinutes: waits.length === 0 ? null : Math.max(...waits),
          };
        }

        default:
          // Reached only if a model invents a tool name. Told plainly, so it
          // corrects itself rather than treating the turn as broken.
          return { error: `There is no tool called ${name}.` };
      }
    },
  };
}
