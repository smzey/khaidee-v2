import {
  type ReportBrief,
  type ReportFacts,
  type ReportableOrder,
  buildReport,
  businessDate,
  daysInRange,
  formatBaht,
  isReportWorthNarrating,
} from '@khaidee/domain';
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { orderLineOptions, orderLines, orders, vendors } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import type { Narrator } from '../lib/narrator.js';

type VendorRow = typeof vendors.$inferSelect;

/** YYYY-MM-DD arithmetic that does not care what timezone the server is in. */
export function shiftDate(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

export interface ReportRange {
  from: string;
  to: string;
}

export interface Report {
  vendor: { id: string; name: string; timeZone: string };
  range: ReportRange;
  facts: ReportFacts;
}

export type BriefLanguage = 'th' | 'en';

export interface WrittenReport extends Report {
  /** Null when there was too little trade to write about honestly. */
  brief: ReportBrief | null;
  skipped: 'not_enough_trade' | null;
  model: string | null;
  /** True when the same figures had already been written up. */
  cached: boolean;
  usage: { inputTokens: number; outputTokens: number } | null;
}

interface CacheEntry {
  factsJson: string;
  brief: ReportBrief;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * A vendor closing up will open the report, put the phone down, and open it
 * again. Rewriting the same figures costs real money and returns a slightly
 * different note each time, which reads like the numbers moved. Keyed on the
 * figures themselves, so a late order invalidates it automatically.
 */
const CACHE_LIMIT = 50;

const MAX_SPAN_DAYS = 92;

export class ReportService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly db: Db,
    private readonly narrator: Narrator | null = null,
  ) {}

  async brief(
    vendor: VendorRow,
    range: ReportRange,
    language: BriefLanguage,
  ): Promise<WrittenReport> {
    const report = await this.facts(vendor, range);
    const base = { ...report, cached: false, usage: null, model: null };

    if (!this.narrator) {
      return {
        ...base,
        brief: templateReportBrief(report.facts, language),
        skipped: null,
        model: 'template',
      };
    }

    if (!isReportWorthNarrating(report.facts)) {
      return { ...base, brief: null, skipped: 'not_enough_trade' };
    }

    const key = `${vendor.id}|${range.from}|${range.to}|${language}`;
    const factsJson = JSON.stringify(report.facts);
    const hit = this.cache.get(key);
    if (hit && hit.factsJson === factsJson) {
      return {
        ...base,
        brief: hit.brief,
        skipped: null,
        model: hit.model,
        usage: hit.usage,
        cached: true,
      };
    }

    const narration = await this.narrator.write({
      stallName: vendor.name,
      facts: report.facts,
      language,
    });

    this.remember(key, { factsJson, ...narration });

    return {
      ...base,
      brief: narration.brief,
      skipped: null,
      model: narration.model,
      usage: narration.usage,
    };
  }

  private remember(key: string, entry: CacheEntry): void {
    this.cache.delete(key);
    this.cache.set(key, entry);
    while (this.cache.size > CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  /** Today in the stall's own timezone — the default range for a day-close. */
  today(vendor: VendorRow): ReportRange {
    const day = businessDate(new Date(), vendor.timeZone);
    return { from: day, to: day };
  }

  /**
   * Fills in whatever the caller left out. An empty request means today, which
   * is what a vendor tapping the button at closing time wants.
   */
  resolveRange(
    vendor: VendorRow,
    input: { from?: string | undefined; to?: string | undefined },
  ): ReportRange {
    const today = businessDate(new Date(), vendor.timeZone);
    const from = input.from ?? input.to ?? today;
    const to = input.to ?? input.from ?? today;

    if (from > to) {
      throw new HttpError(400, 'bad_range', 'The range starts after it ends');
    }
    if (daysInRange(from, to) > MAX_SPAN_DAYS) {
      throw new HttpError(
        400,
        'range_too_long',
        `Reports cover up to ${MAX_SPAN_DAYS} days at a time`,
      );
    }

    return { from, to };
  }

  async facts(vendor: VendorRow, range: ReportRange): Promise<Report> {
    const span = daysInRange(range.from, range.to);
    const previousTo = shiftDate(range.from, -1);
    const previousFrom = shiftDate(previousTo, -(span - 1));

    // One extra query buys the "up ฿420 on last week" line, which is the only
    // number in the whole report a vendor reacts to immediately.
    const [current, previous] = await Promise.all([
      this.ordersIn(vendor.id, range),
      this.ordersIn(vendor.id, { from: previousFrom, to: previousTo }),
    ]);

    return {
      vendor: { id: vendor.id, name: vendor.name, timeZone: vendor.timeZone },
      range,
      facts: buildReport({
        orders: current,
        previous,
        from: range.from,
        to: range.to,
        timeZone: vendor.timeZone,
      }),
    };
  }

  /**
   * Every order in the range, assembled in three queries rather than one per
   * order. A month of trade is thousands of rows, and the N+1 shape that is
   * fine for one queue screen is not fine here.
   */
  private async ordersIn(
    vendorId: string,
    range: ReportRange,
  ): Promise<ReportableOrder[]> {
    const orderRows = await this.db
      .select({
        id: orders.id,
        businessDate: orders.businessDate,
        status: orders.status,
        source: orders.source,
        total: orders.total,
        paymentMethod: orders.paymentMethod,
        placedAt: orders.placedAt,
        readyAt: orders.readyAt,
        completedAt: orders.completedAt,
      })
      .from(orders)
      .where(
        and(
          eq(orders.vendorId, vendorId),
          gte(orders.businessDate, range.from),
          lte(orders.businessDate, range.to),
        ),
      )
      .orderBy(asc(orders.placedAt));

    if (orderRows.length === 0) return [];

    const orderIds = orderRows.map((row) => row.id);

    const lineRows = await this.db
      .select()
      .from(orderLines)
      .where(inArray(orderLines.orderId, orderIds))
      .orderBy(asc(orderLines.sortOrder));

    const optionRows =
      lineRows.length === 0
        ? []
        : await this.db
            .select()
            .from(orderLineOptions)
            .where(
              inArray(
                orderLineOptions.orderLineId,
                lineRows.map((line) => line.id),
              ),
            )
            .orderBy(asc(orderLineOptions.sortOrder));

    const optionsByLine = new Map<
      string,
      Array<{ optionId: string; nameSnapshot: string; priceDelta: number }>
    >();
    for (const option of optionRows) {
      const list = optionsByLine.get(option.orderLineId) ?? [];
      list.push({
        optionId: option.optionId,
        nameSnapshot: option.nameSnapshot,
        priceDelta: option.priceDelta,
      });
      optionsByLine.set(option.orderLineId, list);
    }

    const linesByOrder = new Map<string, ReportableOrder['lines']>();
    for (const line of lineRows) {
      const list = linesByOrder.get(line.orderId) ?? [];
      list.push({
        menuItemId: line.menuItemId,
        qty: line.qty,
        unitPrice: line.unitPrice,
        nameSnapshot: line.nameSnapshot,
        options: optionsByLine.get(line.id) ?? [],
      });
      linesByOrder.set(line.orderId, list);
    }

    return orderRows.map((row) => ({
      businessDate: row.businessDate,
      status: row.status,
      source: row.source,
      total: row.total,
      paymentMethod: row.paymentMethod,
      lines: linesByOrder.get(row.id) ?? [],
      placedAt: row.placedAt.toISOString(),
      readyAt: row.readyAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
    }));
  }
}

function templateReportBrief(facts: ReportFacts, language: BriefLanguage): ReportBrief {
  return language === 'th' ? thaiTemplate(facts) : englishTemplate(facts);
}

function englishTemplate(facts: ReportFacts): ReportBrief {
  const topDish = facts.dishes[0];
  const peakHour = [...facts.hours].sort((a, b) => b.baht - a.baht)[0];
  const movement = movementLine(facts, 'en');
  const quiet = facts.takings.orders === 0;
  return {
    headline: quiet
      ? 'No completed sales yet'
      : `${formatBaht(facts.takings.gross)} from ${facts.takings.orders} orders`,
    summary: quiet
      ? 'No completed orders landed in this period. Open or cancelled orders are kept out of takings.'
      : `Average order was ${formatBaht(facts.takings.averageOrder)} across ${facts.takings.dishesSold} plates. ${movement}`,
    wins: topDish
      ? [`Top dish was ${topDish.name} with ${topDish.qty} sold and ${formatBaht(topDish.baht)}.`]
      : ['No dish has enough completed sales to rank yet.'],
    watch: facts.unfinished.open
      ? [
          `${facts.unfinished.open} orders are still in the queue worth ${formatBaht(facts.unfinished.openBaht)}.`,
        ]
      : facts.unfinished.cancelled
        ? [
            `${facts.unfinished.cancelled} orders were cancelled worth ${formatBaht(facts.unfinished.cancelledBaht)}.`,
          ]
        : [],
    actions: [
      {
        action: topDish
          ? `Prep around the usual amount for ${topDish.name}.`
          : 'Keep prep light until more completed orders come in.',
        because: topDish
          ? `${topDish.name} leads the period at ${formatBaht(topDish.baht)}.`
          : `The report shows ${formatBaht(facts.takings.gross)} gross.`,
        when: 'tonight',
      },
      {
        action: peakHour ? `Watch the ${padHour(peakHour.hour)}:00 rush.` : 'Use the queue as the live signal.',
        because: peakHour
          ? `${padHour(peakHour.hour)}:00 brought in ${formatBaht(peakHour.baht)}.`
          : 'No completed hour pattern is available yet.',
        when: 'this_week',
      },
    ],
    language: 'en',
  };
}

function thaiTemplate(facts: ReportFacts): ReportBrief {
  const topDish = facts.dishes[0];
  const peakHour = [...facts.hours].sort((a, b) => b.baht - a.baht)[0];
  const movement = movementLine(facts, 'th');
  const quiet = facts.takings.orders === 0;
  return {
    headline: quiet
      ? 'ยังไม่มีออเดอร์ที่จบ'
      : `${formatBaht(facts.takings.gross)} จาก ${facts.takings.orders} ออเดอร์`,
    summary: quiet
      ? 'ช่วงนี้ยังไม่มีออเดอร์ที่จบแล้ว ระบบไม่นับออเดอร์ค้างหรือยกเลิกเป็นยอดขาย.'
      : `บิลเฉลี่ย ${formatBaht(facts.takings.averageOrder)} จากทั้งหมด ${facts.takings.dishesSold} จาน. ${movement}`,
    wins: topDish
      ? [`เมนูนำคือ ${topDish.name} ขายได้ ${topDish.qty} จาน เป็นเงิน ${formatBaht(topDish.baht)}.`]
      : ['ยังไม่มีเมนูที่มีออเดอร์จบพอให้จัดอันดับ.'],
    watch: facts.unfinished.open
      ? [
          `ยังมี ${facts.unfinished.open} ออเดอร์ค้างในคิว มูลค่า ${formatBaht(facts.unfinished.openBaht)}.`,
        ]
      : facts.unfinished.cancelled
        ? [
            `มี ${facts.unfinished.cancelled} ออเดอร์ถูกยกเลิก มูลค่า ${formatBaht(facts.unfinished.cancelledBaht)}.`,
          ]
        : [],
    actions: [
      {
        action: topDish
          ? `เตรียมวัตถุดิบของ ${topDish.name} ตามระดับปกติ.`
          : 'เตรียมของเบา ๆ จนกว่าจะมีออเดอร์จบมากขึ้น.',
        because: topDish
          ? `${topDish.name} ทำยอดนำที่ ${formatBaht(topDish.baht)}.`
          : `รายงานแสดงยอดขาย ${formatBaht(facts.takings.gross)}.`,
        when: 'tonight',
      },
      {
        action: peakHour ? `จับตาช่วง ${padHour(peakHour.hour)}:00.` : 'ใช้คิวปัจจุบันเป็นสัญญาณหลัก.',
        because: peakHour
          ? `ช่วง ${padHour(peakHour.hour)}:00 ทำยอด ${formatBaht(peakHour.baht)}.`
          : 'ยังไม่มีรูปแบบชั่วโมงขายจากออเดอร์ที่จบ.',
        when: 'this_week',
      },
    ],
    language: 'th',
  };
}

function movementLine(facts: ReportFacts, language: BriefLanguage): string {
  if (!facts.movement) return '';
  const delta = facts.movement.grossDelta;
  if (language === 'th') {
    if (delta === 0) return 'ยอดเท่ากับช่วงก่อนหน้า.';
    return delta > 0
      ? `มากกว่าช่วงก่อนหน้า ${formatBaht(delta)}.`
      : `น้อยกว่าช่วงก่อนหน้า ${formatBaht(Math.abs(delta))}.`;
  }
  if (delta === 0) return 'Sales matched the previous period.';
  return delta > 0
    ? `That is up ${formatBaht(delta)} from the previous period.`
    : `That is down ${formatBaht(Math.abs(delta))} from the previous period.`;
}

function padHour(hour: number): string {
  return String(hour).padStart(2, '0');
}
