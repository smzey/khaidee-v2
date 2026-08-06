import { buildReport, type ReportableOrder } from '@khaidee/domain';
import {
  buildReportStatementHtml,
  reportStatementFileName,
} from './reportStatement';
import type { VendorReport } from './api';

const order = (over: Partial<ReportableOrder> = {}): ReportableOrder => ({
  businessDate: '2026-08-06',
  status: 'completed',
  source: 'customer',
  total: 70,
  paymentMethod: 'cash',
  placedAt: '2026-08-06T05:00:00.000Z',
  readyAt: '2026-08-06T05:05:00.000Z',
  completedAt: '2026-08-06T05:07:00.000Z',
  lines: [
    {
      menuItemId: 'pad',
      qty: 1,
      unitPrice: 60,
      nameSnapshot: 'Pad <Thai>',
      options: [{ optionId: 'egg', nameSnapshot: 'Fried egg', priceDelta: 10 }],
    },
  ],
  ...over,
});

const report = (): VendorReport => ({
  vendor: { id: 'v1', name: '67 Noodle', timeZone: 'Asia/Bangkok' },
  range: { from: '2026-08-06', to: '2026-08-06' },
  facts: buildReport({
    orders: [order(), order({ total: 25, lines: [{ menuItemId: 'tea', qty: 1, unitPrice: 25, nameSnapshot: 'Thai Tea', options: [] }] })],
    from: '2026-08-06',
    to: '2026-08-06',
    timeZone: 'Asia/Bangkok',
  }),
});

describe('report statement export', () => {
  it('builds a full PDF-ready statement without leaking raw HTML', () => {
    const html = buildReportStatementHtml({
      report: report(),
      brief: {
        headline: 'Good lunch',
        summary: 'Sales were steady.',
        wins: ['Pad Thai led the day.'],
        watch: [],
        actions: [
          {
            action: 'Prep Pad Thai first.',
            because: 'It led sales.',
            when: 'tonight',
          },
        ],
        language: 'en',
      },
    });

    expect(html).toContain('KHAIDEE REPORT');
    expect(html).toContain('67 Noodle');
    expect(html).toContain('Top Dishes');
    expect(html).toContain('Payment');
    expect(html).toContain('Service');
    expect(html).toContain('Pad &lt;Thai&gt;');
    expect(html).not.toContain('Pad <Thai>');
  });

  it('names the file by stall slug and report period', () => {
    expect(reportStatementFileName(report(), '67 Noodle!')).toBe(
      'khaidee-67-noodle--report-2026-08-06.pdf',
    );
  });
});
