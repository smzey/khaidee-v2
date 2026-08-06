import { formatBaht, type ReportBrief } from '@khaidee/domain';
import type { VendorReport } from './api';

export function reportStatementFileName(report: VendorReport, slug: string): string {
  const safeSlug = slug.replace(/[^a-z0-9-]/gi, '-').toLowerCase() || 'stall';
  const period =
    report.range.from === report.range.to
      ? report.range.from
      : `${report.range.from}-to-${report.range.to}`;
  return `khaidee-${safeSlug}-report-${period}.pdf`;
}

export function buildReportStatementHtml({
  report,
  brief,
}: {
  report: VendorReport;
  brief: ReportBrief | null;
}): string {
  const { facts } = report;
  const period =
    report.range.from === report.range.to
      ? report.range.from
      : `${report.range.from} - ${report.range.to}`;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>KhaiDee Report</title>
  <style>
    @page { margin: 28px; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #16181C;
      background: #FBFAF7;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      font-size: 12px;
      line-height: 1.45;
    }
    .sheet {
      background: #FFFFFF;
      border: 1px solid #16181C;
      padding: 24px;
      min-height: 100vh;
    }
    .top {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      border-bottom: 3px solid #16181C;
      padding-bottom: 16px;
      margin-bottom: 18px;
    }
    .brand { font-size: 12px; letter-spacing: 3px; font-weight: 800; color: #55585F; }
    h1 { margin: 4px 0 0; font-size: 28px; line-height: 1.05; }
    h2 {
      margin: 24px 0 8px;
      font-size: 13px;
      letter-spacing: 1.4px;
      text-transform: uppercase;
      color: #55585F;
    }
    .period { text-align: right; font-weight: 800; color: #55585F; }
    .metrics {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      margin-bottom: 18px;
    }
    .metric {
      border: 1px solid #D9D5CC;
      padding: 12px;
      min-height: 70px;
    }
    .value { display: block; font-size: 22px; font-weight: 900; color: #16181C; }
    .label { display: block; margin-top: 4px; color: #55585F; font-weight: 800; text-transform: uppercase; }
    .note {
      border: 1px solid #16181C;
      padding: 14px;
      margin-bottom: 18px;
      background: #FBFAF7;
    }
    .note-title { margin: 0 0 6px; font-size: 18px; font-weight: 900; }
    .note p { margin: 0 0 8px; }
    .points { margin: 8px 0 0; padding-left: 18px; }
    table { width: 100%; border-collapse: collapse; background: #FFFFFF; }
    th {
      text-align: left;
      color: #55585F;
      font-size: 11px;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      border-bottom: 1px solid #16181C;
      padding: 7px 6px;
    }
    td { border-bottom: 1px solid #D9D5CC; padding: 8px 6px; vertical-align: top; }
    .num { text-align: right; white-space: nowrap; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .foot {
      margin-top: 26px;
      padding-top: 10px;
      border-top: 1px solid #D9D5CC;
      color: #55585F;
      font-size: 11px;
      display: flex;
      justify-content: space-between;
    }
  </style>
</head>
<body>
  <main class="sheet">
    <header class="top">
      <div>
        <div class="brand">KHAIDEE REPORT</div>
        <h1>${esc(report.vendor.name)}</h1>
      </div>
      <div class="period">
        <div>Statement</div>
        <div>${esc(period)}</div>
        <div>${esc(report.vendor.timeZone)}</div>
      </div>
    </header>

    <section class="metrics">
      ${metric('Sales', formatBaht(facts.takings.gross))}
      ${metric('Orders', String(facts.takings.orders))}
      ${metric('Average', formatBaht(facts.takings.averageOrder))}
      ${metric('Plates', String(facts.takings.dishesSold))}
    </section>

    ${brief ? briefHtml(brief) : ''}

    <section class="grid">
      <div>
        <h2>Payment</h2>
        <table>
          ${thead(['Method', 'Orders', 'Baht'])}
          <tbody>
            ${moneyRow('Cash', facts.payment.cash.orders, facts.payment.cash.baht)}
            ${moneyRow('PromptPay', facts.payment.promptpay.orders, facts.payment.promptpay.baht)}
            ${moneyRow('Unrecorded', facts.payment.unrecorded.orders, facts.payment.unrecorded.baht)}
          </tbody>
        </table>
      </div>
      <div>
        <h2>Channel</h2>
        <table>
          ${thead(['Channel', 'Orders', 'Baht'])}
          <tbody>
            ${moneyRow('Customer QR', facts.channel.customer.orders, facts.channel.customer.baht)}
            ${moneyRow('Ring-up', facts.channel.vendor.orders, facts.channel.vendor.baht)}
          </tbody>
        </table>
      </div>
    </section>

    <h2>Top Dishes</h2>
    <table>
      ${thead(['Dish', 'Qty', 'Baht', 'Share'])}
      <tbody>
        ${facts.dishes.length
          ? facts.dishes
              .map(
                (dish) => `<tr><td>${esc(dish.name)}</td><td class="num">${dish.qty}</td><td class="num">${formatBaht(dish.baht)}</td><td class="num">${dish.shareOfTakings}%</td></tr>`,
              )
              .join('')
          : emptyRow(4, 'No completed dishes.')}
      </tbody>
    </table>

    <h2>Options</h2>
    <table>
      ${thead(['Option', 'Qty', 'Baht', 'Attach'])}
      <tbody>
        ${facts.options.length
          ? facts.options
              .map(
                (option) => `<tr><td>${esc(option.name)}</td><td class="num">${option.qty}</td><td class="num">${formatBaht(option.baht)}</td><td class="num">${option.attachRate}%</td></tr>`,
              )
              .join('')
          : emptyRow(4, 'No options sold.')}
      </tbody>
    </table>

    <section class="grid">
      <div>
        <h2>By Hour</h2>
        <table>
          ${thead(['Hour', 'Orders', 'Baht'])}
          <tbody>
            ${facts.hours.length
              ? facts.hours
                  .map(
                    (hour) => `<tr><td>${padHour(hour.hour)}:00</td><td class="num">${hour.orders}</td><td class="num">${formatBaht(hour.baht)}</td></tr>`,
                  )
                  .join('')
              : emptyRow(3, 'No completed hourly sales.')}
          </tbody>
        </table>
      </div>
      <div>
        <h2>By Day</h2>
        <table>
          ${thead(['Date', 'Orders', 'Baht'])}
          <tbody>
            ${facts.days.length
              ? facts.days
                  .map(
                    (day) => `<tr><td>${esc(day.date)}</td><td class="num">${day.orders}</td><td class="num">${formatBaht(day.baht)}</td></tr>`,
                  )
                  .join('')
              : emptyRow(3, 'No completed daily sales.')}
          </tbody>
        </table>
      </div>
    </section>

    <section class="grid">
      <div>
        <h2>Service</h2>
        <table>
          <tbody>
            ${factRow('Ready median', min(facts.service.medianMinutesToReady))}
            ${factRow('Ready slowest', min(facts.service.slowestMinutesToReady))}
            ${factRow('Pickup median', min(facts.service.medianMinutesToCollect))}
            ${factRow('Sampled', String(facts.service.sampled))}
          </tbody>
        </table>
      </div>
      <div>
        <h2>Open And Cancelled</h2>
        <table>
          <tbody>
            ${factRow('Open queue', `${facts.unfinished.open} orders / ${formatBaht(facts.unfinished.openBaht)}`)}
            ${factRow('Cancelled', `${facts.unfinished.cancelled} orders / ${formatBaht(facts.unfinished.cancelledBaht)}`)}
            ${factRow('Movement', movement(facts.movement))}
          </tbody>
        </table>
      </div>
    </section>

    <footer class="foot">
      <span>Generated by KhaiDee</span>
      <span>${new Date().toISOString().slice(0, 10)}</span>
    </footer>
  </main>
</body>
</html>`;
}

function briefHtml(brief: ReportBrief): string {
  return `<section class="note">
    <div class="note-title">${esc(brief.headline)}</div>
    <p>${esc(brief.summary)}</p>
    <ul class="points">
      ${[...brief.wins, ...brief.watch]
        .map((point) => `<li>${esc(point)}</li>`)
        .join('')}
      ${brief.actions
        .map(
          (action) =>
            `<li>${esc(action.action)} <strong>${esc(action.because)}</strong></li>`,
        )
        .join('')}
    </ul>
  </section>`;
}

function metric(label: string, value: string): string {
  return `<div class="metric"><span class="value">${esc(value)}</span><span class="label">${esc(label)}</span></div>`;
}

function thead(headers: string[]): string {
  return `<thead><tr>${headers.map((header) => `<th>${esc(header)}</th>`).join('')}</tr></thead>`;
}

function moneyRow(label: string, orders: number, baht: number): string {
  return `<tr><td>${esc(label)}</td><td class="num">${orders}</td><td class="num">${formatBaht(baht)}</td></tr>`;
}

function factRow(label: string, value: string): string {
  return `<tr><td>${esc(label)}</td><td class="num">${esc(value)}</td></tr>`;
}

function emptyRow(colspan: number, text: string): string {
  return `<tr><td colspan="${colspan}">${esc(text)}</td></tr>`;
}

function min(value: number | null): string {
  return value === null ? '-' : `${value} min`;
}

function movement(value: VendorReport['facts']['movement']): string {
  if (!value) return '-';
  if (value.grossDelta === 0) return 'No change';
  const direction = value.grossDelta > 0 ? 'Up' : 'Down';
  return `${direction} ${formatBaht(Math.abs(value.grossDelta))}`;
}

function padHour(hour: number): string {
  return String(hour).padStart(2, '0');
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
