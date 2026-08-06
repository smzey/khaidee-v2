/**
 * Seeds a presentation stall with a month of trading history.
 *
 * Writes to Postgres directly rather than through the API, because the API
 * stamps business_date and placed_at from the clock — there is no way to make
 * yesterday through it, by design.
 *
 * Everything it inserts obeys the same rules the API does:
 *   - total = sum over lines of qty * (dish price + option deltas)
 *   - queue_no starts at 1 per stall per day, in the order sales happened
 *   - a completed order always carries a payment method
 *   - business_date is the Bangkok calendar day of placed_at
 *
 *   npm run seed:demo              seed (wipes and rebuilds the demo stall only)
 *   npm run seed:demo -- --days 60
 */
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import postgres from 'postgres';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const URL = arg('database', process.env.DATABASE_URL ?? 'postgres://localhost:5432/khaidee_dev');
const DAYS = Number(arg('days', 28));
const SLUG = arg('slug', 'padaeng');
const PIN = '1234';
const TZ_OFFSET_HOURS = 7; // Asia/Bangkok

/** Deterministic, so a rehearsal and the real thing show the same numbers. */
let seed = 20260806;
const rnd = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(rnd() * list.length)];
const between = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

/** Exactly the format apps/api/src/lib/auth.ts writes: salt:scrypt(pin, salt, 64). */
const hashPin = (pin) => {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(pin, salt, 64).toString('hex')}`;
};

/** Local Bangkok wall-clock -> a UTC Date. */
const at = (dayOffset, hour, minute) => {
  const now = new Date();
  const base = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    0,
    0,
    0,
  );
  return new Date(
    base + dayOffset * 86_400_000 + (hour - TZ_OFFSET_HOURS) * 3_600_000 + minute * 60_000,
  );
};

/** Minutes past local midnight, now, with headroom so nothing lands ahead of the clock. */
const cutoffMinutes = () => {
  const [h, m] = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(new Date())
    .split(':')
    .map(Number);
  return h * 60 + m - 5;
};

const businessDate = (instant) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);

const NOW = new Date();

const sql = postgres(URL);

// ---------------------------------------------------------------- the stall

const CATEGORIES = [
  { nameTh: 'เส้น', nameEn: 'Noodles' },
  { nameTh: 'ข้าว', nameEn: 'Rice dishes' },
  { nameTh: 'เครื่องดื่ม', nameEn: 'Drinks' },
];

const DISHES = [
  {
    nameTh: 'ผัดไทยกุ้งสด', nameEn: 'Pad Thai with prawns', price: 60, cat: 'Noodles',
    ingredients: [
      { name: 'Rice noodles', qty: 120, unit: 'g' },
      { name: 'Prawns', qty: 4, unit: 'pcs' },
      { name: 'Egg', qty: 1, unit: 'pcs' },
      { name: 'Bean sprouts', qty: 40, unit: 'g' },
    ],
    weight: 30,
  },
  {
    nameTh: 'ผัดซีอิ๊วหมู', nameEn: 'Pad See Ew', price: 55, cat: 'Noodles',
    ingredients: [
      { name: 'Wide noodles', qty: 140, unit: 'g' },
      { name: 'Pork', qty: 70, unit: 'g' },
      { name: 'Chinese broccoli', qty: 50, unit: 'g' },
    ],
    weight: 16,
  },
  {
    nameTh: 'ก๋วยเตี๋ยวเรือ', nameEn: 'Boat noodles', price: 50, cat: 'Noodles',
    ingredients: [
      { name: 'Thin noodles', qty: 100, unit: 'g' },
      { name: 'Beef', qty: 60, unit: 'g' },
    ],
    weight: 14,
  },
  {
    nameTh: 'ข้าวกะเพราหมูสับ', nameEn: 'Pork basil rice', price: 55, cat: 'Rice dishes',
    ingredients: [
      { name: 'Rice', qty: 200, unit: 'g' },
      { name: 'Minced pork', qty: 80, unit: 'g' },
      { name: 'Holy basil', qty: 15, unit: 'g' },
    ],
    weight: 20,
  },
  {
    nameTh: 'ข้าวมันไก่', nameEn: 'Chicken rice', price: 50, cat: 'Rice dishes',
    ingredients: [
      { name: 'Rice', qty: 220, unit: 'g' },
      { name: 'Chicken', qty: 110, unit: 'g' },
    ],
    weight: 12,
  },
  {
    nameTh: 'ชาไทยเย็น', nameEn: 'Thai iced tea', price: 25, cat: 'Drinks',
    ingredients: [
      { name: 'Tea', qty: 12, unit: 'g' },
      { name: 'Condensed milk', qty: 30, unit: 'ml' },
    ],
    weight: 34,
  },
  {
    nameTh: 'โอเลี้ยง', nameEn: 'Iced black coffee', price: 20, cat: 'Drinks',
    ingredients: [{ name: 'Coffee', qty: 15, unit: 'g' }],
    weight: 14,
  },
  {
    nameTh: 'น้ำเปล่า', nameEn: 'Water', price: 10, cat: 'Drinks',
    ingredients: [],
    weight: 18,
  },
];

const GROUPS = {
  'Pad Thai with prawns': [
    {
      nameTh: 'ระดับความเผ็ด', nameEn: 'Spice level', min: 1, max: 1,
      options: [
        { nameTh: 'เผ็ดน้อย', nameEn: 'Mild', delta: 0, w: 5 },
        { nameTh: 'เผ็ดกลาง', nameEn: 'Medium', delta: 0, w: 4 },
        { nameTh: 'เผ็ดมาก', nameEn: 'Thai hot', delta: 0, w: 3 },
      ],
    },
    {
      nameTh: 'เพิ่มเติม', nameEn: 'Add-ons', min: 0, max: 3,
      options: [
        { nameTh: 'ไข่ดาว', nameEn: 'Fried egg', delta: 10, w: 5 },
        { nameTh: 'กุ้งเพิ่ม', nameEn: 'Extra prawns', delta: 30, w: 2 },
        { nameTh: 'เส้นเพิ่ม', nameEn: 'Extra noodles', delta: 15, w: 2 },
      ],
    },
  ],
  'Pork basil rice': [
    {
      nameTh: 'ระดับความเผ็ด', nameEn: 'Spice level', min: 1, max: 1,
      options: [
        { nameTh: 'เผ็ดน้อย', nameEn: 'Mild', delta: 0, w: 3 },
        { nameTh: 'เผ็ดมาก', nameEn: 'Thai hot', delta: 0, w: 5 },
      ],
    },
    {
      nameTh: 'เพิ่มเติม', nameEn: 'Add-ons', min: 0, max: 2,
      options: [{ nameTh: 'ไข่ดาว', nameEn: 'Fried egg', delta: 10, w: 6 }],
    },
  ],
  'Thai iced tea': [
    {
      nameTh: 'ความหวาน', nameEn: 'Sweetness', min: 1, max: 1,
      options: [
        { nameTh: 'หวานปกติ', nameEn: 'Normal', delta: 0, w: 5 },
        { nameTh: 'หวานน้อย', nameEn: 'Less sweet', delta: 0, w: 4 },
        { nameTh: 'ไม่ใส่น้ำตาล', nameEn: 'No sugar', delta: 0, w: 1 },
      ],
    },
  ],
};

const weighted = (list) => {
  const total = list.reduce((sum, x) => sum + (x.w ?? x.weight ?? 1), 0);
  let roll = rnd() * total;
  for (const x of list) {
    roll -= x.w ?? x.weight ?? 1;
    if (roll <= 0) return x;
  }
  return list[list.length - 1];
};

console.log(`Seeding "${SLUG}" with ${DAYS} days of history…`);

await sql.begin(async (tx) => {
  /*
   * Only this stall is touched; every other stall in the database is left
   * alone. Deleted in dependency order rather than by cascade, because
   * order_lines.menu_item_id carries no ON DELETE — history is meant to pin
   * the dish it was sold as, which is exactly why the cascade cannot fire.
   */
  const [existing] = await tx`select id from vendors where slug = ${SLUG}`;
  if (existing) {
    await tx`
      delete from order_line_options where order_line_id in (
        select ol.id from order_lines ol
        join orders o on o.id = ol.order_id
        where o.vendor_id = ${existing.id})`;
    await tx`
      delete from order_lines where order_id in (
        select id from orders where vendor_id = ${existing.id})`;
    await tx`delete from order_events where vendor_id = ${existing.id}`;
    await tx`delete from orders where vendor_id = ${existing.id}`;
    await tx`delete from vendors where id = ${existing.id}`;
  }

  const [vendor] = await tx`
    insert into vendors (slug, name, pin_hash, promptpay_id, time_zone, is_open, tier)
    values (${SLUG}, ${'Pa Daeng Pad Thai'}, ${hashPin(PIN)}, ${'0812345678'},
            ${'Asia/Bangkok'}, true, ${'free'})
    returning id
  `;

  const catIds = {};
  for (const [i, c] of CATEGORIES.entries()) {
    const [row] = await tx`
      insert into categories (vendor_id, name_th, name_en, sort_order)
      values (${vendor.id}, ${c.nameTh}, ${c.nameEn}, ${i}) returning id
    `;
    catIds[c.nameEn] = row.id;
  }

  const dishes = [];
  for (const [i, d] of DISHES.entries()) {
    const [row] = await tx`
      insert into menu_items
        (vendor_id, category_id, name_th, name_en, price_baht, ingredients, is_available, sort_order)
      values (${vendor.id}, ${catIds[d.cat]}, ${d.nameTh}, ${d.nameEn}, ${d.price},
              ${JSON.stringify(d.ingredients)}::jsonb, true, ${i})
      returning id
    `;

    const groups = [];
    for (const [gi, g] of (GROUPS[d.nameEn] ?? []).entries()) {
      const [gr] = await tx`
        insert into option_groups (menu_item_id, name_th, name_en, min_select, max_select, sort_order)
        values (${row.id}, ${g.nameTh}, ${g.nameEn}, ${g.min}, ${g.max}, ${gi})
        returning id
      `;
      const opts = [];
      for (const [oi, o] of g.options.entries()) {
        const [or] = await tx`
          insert into options (group_id, name_th, name_en, price_delta_baht, is_available, sort_order)
          values (${gr.id}, ${o.nameTh}, ${o.nameEn}, ${o.delta}, true, ${oi})
          returning id
        `;
        opts.push({ id: or.id, name: o.nameEn, delta: o.delta, w: o.w });
      }
      groups.push({ ...g, options: opts });
    }

    dishes.push({ ...d, id: row.id, groups });
  }

  // ------------------------------------------------------------- the trading

  let orders = 0;
  let cancelled = 0;
  let openNow = 0;

  for (let day = -DAYS; day <= 0; day += 1) {
    const dow = new Date(at(day, 12, 0)).getUTCDay();
    const weekend = dow === 0 || dow === 6;

    // A gentle month-on-month climb, so "up on last week" is a true story.
    const growth = 1 + ((DAYS + day) / DAYS) * 0.28;
    const base = weekend ? between(46, 58) : between(30, 42);
    const count = Math.max(6, Math.round(base * growth));

    // Sales are ordered by time so queue numbers come out in the right order.
    let times = [];
    for (let i = 0; i < count; i += 1) {
      // Two humps: lunch, then dinner.
      const lunch = rnd() < 0.62;
      const hour = lunch ? between(10, 13) : between(17, 20);
      times.push({ hour, minute: between(0, 59) });
    }
    times.sort((a, b) => a.hour - b.hour || a.minute - b.minute);

    /*
     * Today stops at the clock. A stall at 14:00 has served lunch and nothing
     * else — an order stamped 20:00 this evening is a sale nobody has made. It
     * would sit in the queue with a negative wait and make the report describe
     * a day that has not happened.
     */
    if (day === 0) {
      const cutoff = cutoffMinutes();
      times = times.filter((t) => t.hour * 60 + t.minute <= cutoff);
    }

    let queueNo = 0;

    for (const time of times) {
      const placedAt = at(day, time.hour, time.minute);
      queueNo += 1;

      // Basket: one or two dishes, a drink more often than not.
      const lines = [];
      const mains = DISHES.filter((d) => d.cat !== 'Drinks');
      const nMains = rnd() < 0.24 ? 2 : 1;
      for (let i = 0; i < nMains; i += 1) lines.push(weighted(mains));
      if (rnd() < 0.68) lines.push(weighted(DISHES.filter((d) => d.cat === 'Drinks')));

      const built = lines.map((spec) => {
        const dish = dishes.find((d) => d.nameEn === spec.nameEn);
        const qty = rnd() < 0.12 ? 2 : 1;
        const chosen = [];

        for (const group of dish.groups) {
          if (group.min >= 1) {
            chosen.push(weighted(group.options));
          } else {
            for (const option of group.options) {
              // Attach rates that give the report something to notice.
              if (rnd() < (option.name === 'Fried egg' ? 0.3 : 0.1)) chosen.push(option);
            }
          }
        }

        const unit = dish.price + chosen.reduce((s, o) => s + o.delta, 0);
        return { dish, qty, chosen, unitPrice: dish.price, lineTotal: qty * unit };
      });

      const total = built.reduce((s, l) => s + l.lineTotal, 0);

      // Status: today keeps a few live on the counter; history is settled.
      let status = 'completed';
      let acceptedAt = new Date(placedAt.getTime() + between(0, 2) * 60_000);
      let readyAt = new Date(acceptedAt.getTime() + between(4, 12) * 60_000);
      let completedAt = new Date(readyAt.getTime() + between(1, 6) * 60_000);
      let paymentMethod = rnd() < 0.64 ? 'cash' : 'promptpay';

      if (rnd() < 0.045) {
        status = 'cancelled';
        acceptedAt = null;
        readyAt = null;
        completedAt = null;
        paymentMethod = null;
        cancelled += 1;
      } else if (day === 0 && rnd() < 0.14) {
        // Live on the counter right now.
        const stage = rnd();
        paymentMethod = null;
        completedAt = null;
        if (stage < 0.34) {
          status = 'placed';
          acceptedAt = null;
          readyAt = null;
        } else if (stage < 0.7) {
          status = 'accepted';
          readyAt = null;
        } else {
          status = 'ready';
        }
        openNow += 1;
      }

      /*
       * An order placed four minutes ago cannot already be collected. Roll it
       * back to whichever stage the clock actually allows, rather than writing
       * a completion that has not happened yet.
       */
      if (status === 'completed' && completedAt > NOW) {
        paymentMethod = null;
        completedAt = null;
        if (readyAt > NOW) {
          readyAt = null;
          status = acceptedAt > NOW ? 'placed' : 'accepted';
          if (status === 'placed') acceptedAt = null;
        } else {
          status = 'ready';
        }
        openNow += 1;
      }

      const [order] = await tx`
        insert into orders
          (vendor_id, client_id, business_date, queue_no, status, source, total_baht,
           payment_method, placed_at, accepted_at, ready_at, completed_at)
        values (${vendor.id}, ${randomUUID()}, ${businessDate(placedAt)}, ${queueNo},
                ${status}, ${rnd() < 0.68 ? 'customer' : 'vendor'}, ${total},
                ${paymentMethod}, ${placedAt}, ${acceptedAt}, ${readyAt}, ${completedAt})
        returning id
      `;

      for (const [i, line] of built.entries()) {
        const [lineRow] = await tx`
          insert into order_lines (order_id, menu_item_id, qty, unit_price_baht, name_snapshot, sort_order)
          values (${order.id}, ${line.dish.id}, ${line.qty}, ${line.unitPrice},
                  ${line.dish.nameEn}, ${i})
          returning id
        `;
        for (const [oi, option] of line.chosen.entries()) {
          await tx`
            insert into order_line_options
              (order_line_id, option_id, name_snapshot, price_delta_baht, sort_order)
            values (${lineRow.id}, ${option.id}, ${option.name}, ${option.delta}, ${oi})
          `;
        }
      }

      orders += 1;
    }
  }

  console.log(`  ${orders} orders, ${cancelled} cancelled, ${openNow} still on the counter`);
});

// ------------------------------------------------------------------ summary

const [totals] = await sql`
  select
    count(*) filter (where o.status = 'completed') as sales,
    coalesce(sum(o.total_baht) filter (where o.status = 'completed'), 0) as gross,
    min(o.business_date) as first_day,
    max(o.business_date) as last_day
  from orders o join vendors v on v.id = o.vendor_id
  where v.slug = ${SLUG}
`;

const today = businessDate(new Date());
const [todayRow] = await sql`
  select
    count(*) filter (where o.status = 'completed') as sales,
    coalesce(sum(o.total_baht) filter (where o.status = 'completed'), 0) as gross,
    count(*) filter (where o.status in ('placed','accepted','ready')) as open
  from orders o join vendors v on v.id = o.vendor_id
  where v.slug = ${SLUG} and o.business_date = ${today}
`;

console.log('');
console.log(`  Stall     Pa Daeng Pad Thai  (/s/${SLUG}, PIN ${PIN})`);
console.log(`  History   ${totals.first_day} → ${totals.last_day}`);
console.log(`  All time  ${totals.sales} sales, ฿${Number(totals.gross).toLocaleString('en-US')}`);
console.log(`  Today     ${todayRow.sales} sales, ฿${Number(todayRow.gross).toLocaleString('en-US')}, ${todayRow.open} on the counter`);

await sql.end();
