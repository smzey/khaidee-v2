import { type OrderDto, formatBaht } from '@khaidee/domain';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { vendorPushTokens } from '../db/schema.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export class PushService {
  constructor(
    private readonly db: Db,
    private readonly fetchImpl?: typeof fetch,
  ) {}

  async register(params: {
    vendorId: string;
    token: string;
    platform?: 'ios' | 'android' | null;
  }) {
    const [row] = await this.db
      .insert(vendorPushTokens)
      .values({
        vendorId: params.vendorId,
        token: params.token,
        platform: params.platform ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: vendorPushTokens.token,
        set: {
          vendorId: params.vendorId,
          platform: params.platform ?? null,
          updatedAt: new Date(),
        },
      })
      .returning({
        id: vendorPushTokens.id,
        token: vendorPushTokens.token,
        platform: vendorPushTokens.platform,
      });

    return row;
  }

  async notifyNewOrder(order: OrderDto): Promise<void> {
    const rows = await this.db
      .select({ token: vendorPushTokens.token })
      .from(vendorPushTokens)
      .where(eq(vendorPushTokens.vendorId, order.vendorId));

    if (rows.length === 0) return;

    const itemCount = order.lines.reduce((total, line) => total + line.qty, 0);
    const firstItem = order.lines[0]?.nameSnapshot;
    const body = firstItem
      ? `${itemCount} ${itemCount === 1 ? 'item' : 'items'} · ${firstItem} · ${formatBaht(order.total)}`
      : `${formatBaht(order.total)} waiting`;

    await (this.fetchImpl ?? fetch)(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'accept-encoding': 'gzip, deflate',
        'content-type': 'application/json',
      },
      body: JSON.stringify(
        rows.map((row) => ({
          to: row.token,
          sound: 'default',
          title: `New order #${order.queueNo}`,
          body,
          data: { orderId: order.id },
        })),
      ),
    });
  }
}
