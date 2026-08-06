import { cancelOrderSchema, placeOrderSchema } from '@khaidee/domain';
import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import type { EventBroker } from '../lib/broker.js';
import { sseHandler } from '../lib/sse.js';
import type { MenuService } from '../services/menu.js';
import type { OrderService } from '../services/orders.js';
import type { PushService } from '../services/push.js';

/**
 * The customer side. No account, no install, no token — the QR is the
 * credential, and an order id is unguessable enough to check on.
 */
export function storefrontRoutes(
  app: FastifyInstance,
  orderService: OrderService,
  menuService: MenuService,
  broker: EventBroker,
  pushService: PushService,
): void {
  /** What the QR opens. */
  app.get<{ Params: { slug: string } }>('/s/:slug', async (request) => {
    const vendor = await orderService.vendorBySlug(request.params.slug);
    const [categories, menu] = await Promise.all([
      menuService.categoriesFor(vendor.id),
      menuService.menuFor(vendor.id),
    ]);

    const customerMenu = menu.map(({ ingredients: _ingredients, ...item }) => item);

    return {
      vendor: {
        id: vendor.id,
        slug: vendor.slug,
        name: vendor.name,
        isOpen: vendor.isOpen,
      },
      categories,
      // Sold-out dishes stay visible but unorderable — a customer should see
      // that the stall sells Pad Thai even on a day it has run out.
      menu: customerMenu,
    };
  });

  app.post<{ Params: { slug: string } }>('/s/:slug/orders', async (request, reply) => {
    const body = placeOrderSchema.parse(request.body);
    const vendor = await orderService.vendorBySlug(request.params.slug);

    const { order, created } = await orderService.place({
      vendor,
      lines: body.lines,
      clientId: body.clientId,
      source: 'customer',
    });

    // A retry gets 200 and the same order; only a genuinely new one gets 201.
    reply.code(created ? 201 : 200);
    if (created) {
      void pushService.notifyNewOrder(order).catch((error) => {
        request.log.warn({ err: error }, 'new order push notification failed');
      });
    }
    return order;
  });

  /** Poll fallback for a customer whose browser dropped the stream. */
  app.get<{ Params: { id: string } }>('/orders/:id', async (request) =>
    orderService.byId(request.params.id),
  );

  /**
   * The collect screen: what is owed, and a PromptPay payload for exactly
   * that amount into the vendor's own account. Null payload means the stall
   * takes cash only.
   */
  app.get<{ Params: { id: string } }>('/orders/:id/payment', async (request) => {
    const payment = await orderService.paymentFor(request.params.id);
    if (!payment.promptpayPayload) {
      return { ...payment, promptpayQrDataUrl: null };
    }

    return {
      ...payment,
      promptpayQrDataUrl: await QRCode.toDataURL(payment.promptpayPayload, {
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
        errorCorrectionLevel: 'Q',
        margin: 4,
        width: 480,
      }),
    };
  });

  /**
   * Changed their mind. Allowed only while the order is still `placed` —
   * once the stall accepts, the ingredients are committed.
   */
  app.post<{ Params: { id: string } }>('/orders/:id/cancel', async (request) => {
    const { clientId } = cancelOrderSchema.parse(request.body);
    return orderService.cancelByCustomer(request.params.id, clientId);
  });

  /** "Cooking" → "Ready — come and collect", pushed as it happens. */
  app.get<{ Params: { id: string } }>('/orders/:id/stream', async (request, reply) => {
    const order = await orderService.byId(request.params.id);
    const stream = sseHandler(request, reply);
    stream.send({ id: 0, type: 'order.updated', order });
    const unsubscribe = broker.subscribeOrder(order.id, (event) =>
      stream.send(event),
    );
    stream.onClose(unsubscribe);
  });
}
