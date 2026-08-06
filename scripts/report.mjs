#!/usr/bin/env node
/**
 * Prints a stall's report at the terminal — the figures always, and the
 * written note when the API has an Anthropic key.
 *
 *   npm run report -- --slug teststall --pin 1234
 *   npm run report -- --slug teststall --pin 1234 --from 2026-08-01 --to 2026-08-05
 *   npm run report -- --slug teststall --pin 1234 --lang en
 *   npm run report -- --slug teststall --pin 1234 --facts-only
 *
 * This exists so the report can be read without waiting for a screen to be
 * built for it, and so a real API key can be exercised end to end the moment
 * it is set.
 */

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith('--')) continue;
  const key = arg.slice(2);
  const next = process.argv[i + 1];
  if (next && !next.startsWith('--')) {
    args.set(key, next);
    i += 1;
  } else {
    args.set(key, 'true');
  }
}

const API = args.get('api') ?? process.env.API_URL ?? 'http://localhost:3000';
const slug = args.get('slug');
const pin = args.get('pin');

if (!slug || !pin) {
  console.error('Usage: npm run report -- --slug <stall> --pin <pin> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--lang th|en] [--facts-only]');
  process.exit(1);
}

const baht = (value) => `฿${Number(value).toLocaleString('en-US')}`;
const bold = (text) => `[1m${text}[0m`;
const dim = (text) => `[2m${text}[0m`;

async function call(path, init) {
  const response = await fetch(`${API}${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body.message ?? response.statusText;
    throw new Error(`${path} → ${response.status} ${detail}`);
  }
  return body;
}

const session = await call('/vendor/session', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ slug, pin }),
});

const auth = { authorization: `Bearer ${session.token}` };
const range = {};
if (args.get('from')) range.from = args.get('from');
if (args.get('to')) range.to = args.get('to');

const factsOnly = args.get('facts-only') === 'true';

const report = factsOnly
  ? await call(
      `/vendor/report${new URLSearchParams(range).toString() ? `?${new URLSearchParams(range)}` : ''}`,
      { headers: auth },
    )
  : await call('/vendor/report/brief', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ ...range, language: args.get('lang') ?? 'th' }),
    }).catch(async (error) => {
      console.error(dim(`\n(written report unavailable: ${error.message})`));
      return call(
        `/vendor/report${new URLSearchParams(range).toString() ? `?${new URLSearchParams(range)}` : ''}`,
        { headers: auth },
      );
    });

const { facts } = report;
const span =
  report.range.from === report.range.to
    ? report.range.from
    : `${report.range.from} → ${report.range.to}`;

console.log(`\n${bold(report.vendor.name)}  ${dim(span)}\n`);

console.log(
  `  ${bold(baht(facts.takings.gross))} from ${facts.takings.orders} orders` +
    `  ${dim(`avg ${baht(facts.takings.averageOrder)} · ${facts.takings.dishesSold} plates`)}`,
);

if (facts.movement) {
  const { grossDelta, grossPercent } = facts.movement;
  const sign = grossDelta >= 0 ? '+' : '−';
  const pct = grossPercent === null ? '' : ` (${sign}${Math.abs(grossPercent)}%)`;
  console.log(
    dim(`  ${sign}${baht(Math.abs(grossDelta))}${pct} on the period before`),
  );
}

if (facts.unfinished.open || facts.unfinished.cancelled) {
  console.log(
    dim(
      `  ${facts.unfinished.open} still in the queue (${baht(facts.unfinished.openBaht)})` +
        ` · ${facts.unfinished.cancelled} cancelled (${baht(facts.unfinished.cancelledBaht)})`,
    ),
  );
}

if (facts.dishes.length) {
  console.log(`\n  ${bold('Dishes')}`);
  for (const dish of facts.dishes.slice(0, 8)) {
    console.log(
      `    ${String(dish.qty).padStart(4)} × ${dish.name.padEnd(22)} ${baht(dish.baht).padStart(9)}  ${dim(`${dish.shareOfTakings}%`)}`,
    );
  }
}

if (facts.options.length) {
  console.log(`\n  ${bold('Options')}`);
  for (const option of facts.options.slice(0, 6)) {
    console.log(
      `    ${String(option.qty).padStart(4)} × ${option.name.padEnd(22)} ${baht(option.baht).padStart(9)}  ${dim(`${option.attachRate}% of plates`)}`,
    );
  }
}

if (facts.hours.length) {
  console.log(`\n  ${bold('By hour')}`);
  const peak = Math.max(...facts.hours.map((hour) => hour.baht));
  for (const hour of facts.hours) {
    const bar = '█'.repeat(Math.max(1, Math.round((hour.baht / peak) * 24)));
    console.log(
      `    ${String(hour.hour).padStart(2, '0')}:00  ${bar} ${dim(baht(hour.baht))}`,
    );
  }
}

if (facts.service.sampled) {
  console.log(
    `\n  ${bold('Service')}  ${dim(
      `${facts.service.medianMinutesToReady} min to ready (slowest ${facts.service.slowestMinutesToReady}), ` +
        `${facts.service.medianMinutesToCollect} min sitting before collection`,
    )}`,
  );
}

console.log(
  `\n  ${bold('Paid')}  ${dim(
    `cash ${baht(facts.payment.cash.baht)} · promptpay ${baht(facts.payment.promptpay.baht)}` +
      (facts.payment.unrecorded.orders
        ? ` · unrecorded ${baht(facts.payment.unrecorded.baht)}`
        : ''),
  )}`,
);

if (report.skipped === 'not_enough_trade') {
  console.log(dim('\n  Too little trade to write up. The figures above are all of it.\n'));
} else if (report.brief) {
  const { brief } = report;
  console.log(`\n${'─'.repeat(60)}\n`);
  console.log(`  ${bold(brief.headline)}\n`);
  console.log(`  ${brief.summary}\n`);

  for (const win of brief.wins) console.log(`  ✓ ${win}`);
  for (const item of brief.watch) console.log(`  ! ${item}`);

  if (brief.actions.length) console.log('');
  for (const action of brief.actions) {
    const when = action.when === 'tonight' ? 'tonight' : 'this week';
    console.log(`  → ${action.action}  ${dim(`(${when})`)}`);
    console.log(`    ${dim(action.because)}`);
  }

  console.log(
    dim(
      `\n  ${report.cached ? 'cached' : report.model} · ` +
        `${report.usage ? `${report.usage.inputTokens} in / ${report.usage.outputTokens} out` : 'no usage'}\n`,
    ),
  );
} else {
  console.log('');
}
