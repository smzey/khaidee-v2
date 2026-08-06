/**
 * The numbers behind a report.
 *
 * Every figure a vendor is shown — or that a language model is later asked to
 * write about — is computed here, in whole baht, from orders the server holds.
 * Nothing in this file talks to a model, and no model is ever asked to add up
 * money: an LLM that miscounts a sentence is a bad sentence, but an LLM that
 * miscounts takings is a vendor who cannot reconcile their cash box.
 *
 * The division of labour for the AI report is therefore strict:
 *   report.ts   decides WHAT IS TRUE
 *   the model   decides WHAT TO SAY ABOUT IT
 */
import { lineTotal } from './cart.js';
import { localHour, minutesBetween } from './dates.js';
import type { Order, OrderLine, PaymentMethod } from './types.js';

/** The slice of an order a report reads. Both Order and OrderDto satisfy it. */
export type ReportableOrder = Pick<
  Order,
  | 'businessDate'
  | 'status'
  | 'source'
  | 'total'
  | 'paymentMethod'
  | 'lines'
  | 'placedAt'
  | 'readyAt'
  | 'completedAt'
>;

export interface Tally {
  orders: number;
  baht: number;
}

export interface DishFact {
  menuItemId: string;
  name: string;
  qty: number;
  baht: number;
  /** Percent of takings this dish accounts for, one decimal. */
  shareOfTakings: number;
}

export interface OptionFact {
  name: string;
  qty: number;
  /** Extra baht this option brought in on its own. Often zero. */
  baht: number;
  /** Percent of all dishes sold that carried it, one decimal. */
  attachRate: number;
}

export interface HourFact {
  /** 0–23 in the stall's own timezone. */
  hour: number;
  orders: number;
  baht: number;
}

export interface DayFact {
  date: string;
  orders: number;
  baht: number;
}

export interface ServiceFact {
  /** How many completed orders had a "ready" time to measure. */
  sampled: number;
  /** Placed → ready: what the customer actually waited. */
  medianMinutesToReady: number | null;
  slowestMinutesToReady: number | null;
  /** Ready → collected: how long finished food sat on the counter. */
  medianMinutesToCollect: number | null;
}

export interface Movement {
  previousGross: number;
  previousOrders: number;
  grossDelta: number;
  /** Null when the previous period took nothing — there is no percent of zero. */
  grossPercent: number | null;
  ordersDelta: number;
}

export interface ReportFacts {
  period: { from: string; to: string; days: number; timeZone: string };
  takings: {
    gross: number;
    orders: number;
    averageOrder: number;
    dishesSold: number;
    distinctDishes: number;
  };
  /** Money that did not land, kept separate so takings stay honest. */
  unfinished: {
    open: number;
    openBaht: number;
    cancelled: number;
    cancelledBaht: number;
  };
  payment: { cash: Tally; promptpay: Tally; unrecorded: Tally };
  channel: { customer: Tally; vendor: Tally };
  /** Best sellers first. Capped — distinctDishes says how many there were. */
  dishes: DishFact[];
  options: OptionFact[];
  /** Only hours that saw trade, ascending. */
  hours: HourFact[];
  days: DayFact[];
  service: ServiceFact;
  /** Null unless the caller supplied a previous period to compare against. */
  movement: Movement | null;
}

const MAX_DISHES = 25;
const MAX_OPTIONS = 20;

const round1 = (value: number): number => Math.round(value * 10) / 10;

const percent = (part: number, whole: number): number =>
  whole === 0 ? 0 : round1((part / whole) * 100);

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return Math.round(((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2);
}

/** Options are priced per unit, so their contribution scales with quantity. */
const optionBaht = (line: OrderLine): number =>
  line.qty * line.options.reduce((sum, option) => sum + option.priceDelta, 0);

/**
 * Only completed orders count as takings.
 *
 * An order sitting at "ready" is food, not money — the customer has not paid
 * and may never appear. Counting it would flatter the day and then quietly
 * disagree with the cash box, which is the one number a vendor can check.
 */
const isTakings = (order: ReportableOrder): boolean =>
  order.status === 'completed';

const isOpen = (order: ReportableOrder): boolean =>
  order.status === 'placed' ||
  order.status === 'accepted' ||
  order.status === 'ready';

function tallyOf(orders: readonly ReportableOrder[]): Tally {
  return {
    orders: orders.length,
    baht: orders.reduce((sum, order) => sum + order.total, 0),
  };
}

/** Whole days in an inclusive YYYY-MM-DD range. */
export function daysInRange(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 1;
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

export interface BuildReportParams {
  orders: readonly ReportableOrder[];
  from: string;
  to: string;
  timeZone: string;
  /** The equivalent stretch before this one, for the movement line. */
  previous?: readonly ReportableOrder[];
}

export function buildReport(params: BuildReportParams): ReportFacts {
  const { orders, from, to, timeZone } = params;

  const sold = orders.filter(isTakings);
  const gross = sold.reduce((sum, order) => sum + order.total, 0);

  const dishes = new Map<string, { name: string; qty: number; baht: number }>();
  const options = new Map<string, { qty: number; baht: number }>();
  let dishesSold = 0;

  for (const order of sold) {
    for (const line of order.lines) {
      dishesSold += line.qty;

      const dish = dishes.get(line.menuItemId) ?? {
        name: line.nameSnapshot,
        qty: 0,
        baht: 0,
      };
      dish.qty += line.qty;
      dish.baht += lineTotal(line);
      // The newest snapshot wins, so a renamed dish reads as it does today.
      dish.name = line.nameSnapshot;
      dishes.set(line.menuItemId, dish);

      for (const chosen of line.options) {
        const option = options.get(chosen.nameSnapshot) ?? { qty: 0, baht: 0 };
        option.qty += line.qty;
        option.baht += line.qty * chosen.priceDelta;
        options.set(chosen.nameSnapshot, option);
      }
    }
  }

  const hours = new Map<number, { orders: number; baht: number }>();
  const days = new Map<string, { orders: number; baht: number }>();

  for (const order of sold) {
    const hour = localHour(order.placedAt, timeZone);
    const hourBucket = hours.get(hour) ?? { orders: 0, baht: 0 };
    hourBucket.orders += 1;
    hourBucket.baht += order.total;
    hours.set(hour, hourBucket);

    const dayBucket = days.get(order.businessDate) ?? { orders: 0, baht: 0 };
    dayBucket.orders += 1;
    dayBucket.baht += order.total;
    days.set(order.businessDate, dayBucket);
  }

  const toReady = sold
    .filter((order) => order.readyAt !== null)
    .map((order) => minutesBetween(order.placedAt, order.readyAt as string));

  const toCollect = sold
    .filter((order) => order.readyAt !== null && order.completedAt !== null)
    .map((order) =>
      minutesBetween(order.readyAt as string, order.completedAt as string),
    );

  const paidWith = (method: PaymentMethod): Tally =>
    tallyOf(sold.filter((order) => order.paymentMethod === method));

  const optionFacts: OptionFact[] = [...options.entries()]
    .map(([name, value]) => ({
      name,
      qty: value.qty,
      baht: value.baht,
      attachRate: percent(value.qty, dishesSold),
    }))
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));

  const dishFacts: DishFact[] = [...dishes.entries()]
    .map(([menuItemId, value]) => ({
      menuItemId,
      name: value.name,
      qty: value.qty,
      baht: value.baht,
      shareOfTakings: percent(value.baht, gross),
    }))
    .sort((a, b) => b.baht - a.baht || a.name.localeCompare(b.name));

  const open = orders.filter(isOpen);
  const cancelled = orders.filter((order) => order.status === 'cancelled');

  return {
    period: { from, to, days: daysInRange(from, to), timeZone },
    takings: {
      gross,
      orders: sold.length,
      averageOrder: sold.length === 0 ? 0 : Math.round(gross / sold.length),
      dishesSold,
      distinctDishes: dishes.size,
    },
    unfinished: {
      open: open.length,
      openBaht: open.reduce((sum, order) => sum + order.total, 0),
      cancelled: cancelled.length,
      cancelledBaht: cancelled.reduce((sum, order) => sum + order.total, 0),
    },
    payment: {
      cash: paidWith('cash'),
      promptpay: paidWith('promptpay'),
      unrecorded: tallyOf(sold.filter((order) => order.paymentMethod === null)),
    },
    channel: {
      customer: tallyOf(sold.filter((order) => order.source === 'customer')),
      vendor: tallyOf(sold.filter((order) => order.source === 'vendor')),
    },
    dishes: dishFacts.slice(0, MAX_DISHES),
    options: optionFacts.slice(0, MAX_OPTIONS),
    hours: [...hours.entries()]
      .map(([hour, value]) => ({ hour, orders: value.orders, baht: value.baht }))
      .sort((a, b) => a.hour - b.hour),
    days: [...days.entries()]
      .map(([date, value]) => ({ date, orders: value.orders, baht: value.baht }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    service: {
      sampled: toReady.length,
      medianMinutesToReady: median(toReady),
      slowestMinutesToReady: toReady.length === 0 ? null : Math.max(...toReady),
      medianMinutesToCollect: median(toCollect),
    },
    movement: params.previous ? movementOf(gross, sold.length, params.previous) : null,
  };
}

function movementOf(
  gross: number,
  orders: number,
  previous: readonly ReportableOrder[],
): Movement {
  const before = previous.filter(isTakings);
  const previousGross = before.reduce((sum, order) => sum + order.total, 0);

  return {
    previousGross,
    previousOrders: before.length,
    grossDelta: gross - previousGross,
    grossPercent:
      previousGross === 0
        ? null
        : round1(((gross - previousGross) / previousGross) * 100),
    ordersDelta: orders - before.length,
  };
}

/**
 * Whether there is enough here to be worth writing about.
 *
 * Below this a narrative is invention dressed as insight — "your busiest hour
 * was 11:00" off a single sale is true and worthless. The API checks this
 * before spending a model call.
 */
export function isReportWorthNarrating(facts: ReportFacts): boolean {
  return facts.takings.orders >= 3;
}

/** The one-line answer, for a screen that has room for exactly one line. */
export function headlineNumbers(facts: ReportFacts): {
  gross: number;
  orders: number;
  topDish: string | null;
  peakHour: number | null;
} {
  const peak = [...facts.hours].sort((a, b) => b.baht - a.baht)[0];
  return {
    gross: facts.takings.gross,
    orders: facts.takings.orders,
    topDish: facts.dishes[0]?.name ?? null,
    peakHour: peak?.hour ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * What the model is allowed to hand back.
 * ------------------------------------------------------------------ */

export type ActionWhen = 'tonight' | 'this_week';

export interface ReportAction {
  /** Imperative and specific: something one person can do at a stall. */
  action: string;
  /** The figure it rests on, so the vendor can disagree with the reasoning. */
  because: string;
  when: ActionWhen;
}

export interface ReportBrief {
  headline: string;
  summary: string;
  wins: string[];
  watch: string[];
  actions: ReportAction[];
  language: 'th' | 'en';
}
