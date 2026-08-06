import {
  FEATURES,
  PLANS,
  TIER_ORDER,
  type Tier,
  businessDate,
  completeOrderSchema,
  promptPayPayload,
  pushTokenSchema,
  ringUpSchema,
  vendorSessionSchema,
} from '@khaidee/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import QRCode from 'qrcode';
import { bearer, issueToken, readToken, verifyPin } from '../lib/auth.js';
import type { EventBroker } from '../lib/broker.js';
import { requireFeature, tierSummary } from '../lib/entitlements.js';
import { HttpError, notFound, unauthorized } from '../lib/errors.js';
import { storeDishImage } from '../lib/images.js';
import { lastEventId, sseHandler } from '../lib/sse.js';
import type { MenuService } from '../services/menu.js';
import type { OrderService } from '../services/orders.js';
import type { PushService } from '../services/push.js';
import type { ForecastService } from '../services/forecast.js';
import type { ReportService } from '../services/reports.js';
import type { VendorService } from '../services/vendors.js';
import type { AssistantService } from '../services/assistant.js';
import {
  assistantAskSchema,
  categoryInputSchema,
  categoryUpdateSchema,
  menuItemInputSchema,
  menuItemUpdateSchema,
  optionGroupInputSchema,
  promptpayQrSchema,
  reportRangeSchema,
  stallUpdateSchema,
} from './vendorSchemas.js';

/**
 * The vendor side: the order queue, the transitions, and tapping in walk-ups.
 * A PIN per stall is the sign-in for this build; the token is signed, so
 * there is no session table to keep.
 */
export function vendorRoutes(
  app: FastifyInstance,
  orderService: OrderService,
  menuService: MenuService,
  vendorService: VendorService,
  broker: EventBroker,
  pushService: PushService,
  reportService: ReportService,
  forecastService: ForecastService,
  assistantService: AssistantService,
): void {
  const vendorIdFrom = (request: FastifyRequest): string =>
    readToken(bearer(request.headers.authorization));

  /** Keeps report-range gating in one place if plan rules change later. */
  const gateRange = (
    vendor: { tier: Tier; timeZone: string },
    range: { from: string; to: string },
  ) => {
    const today = businessDate(new Date(), vendor.timeZone);
    if (range.from === today && range.to === today) return;
    requireFeature(vendor.tier, 'ai_report_range');
  };

  app.post('/vendor/session', async (request) => {
    const body = vendorSessionSchema.parse(request.body);
    const vendor = await orderService
      .vendorBySlug(body.slug)
      .catch(() => orderService.vendorByName(body.slug))
      .catch(() => null);
    // Same answer whether the slug or the PIN was wrong, so this cannot be
    // used to find out which stalls exist.
    if (!vendor || !verifyPin(body.pin, vendor.pinHash)) throw unauthorized();

    return {
      token: issueToken(vendor.id),
      vendor: {
        id: vendor.id,
        slug: vendor.slug,
        name: vendor.name,
        promptpayId: vendor.promptpayId,
        isOpen: vendor.isOpen,
        tier: vendor.tier,
      },
      plan: tierSummary(vendor.tier),
    };
  });

  /**
   * The plans screen, served rather than hardcoded in the app, so a price
   * change does not need an app-store release to reach a vendor's phone.
   */
  app.get('/vendor/plans', async (request) => {
    const vendor = await orderService.vendorById(vendorIdFrom(request));
    return {
      current: vendor.tier,
      plans: TIER_ORDER.map((tier) => PLANS[tier]),
      features: FEATURES,
    };
  });

  app.patch('/vendor/stall', async (request) => {
    const body = stallUpdateSchema.parse(request.body);
    return vendorService.updateStall({
      vendorId: vendorIdFrom(request),
      ...body,
    });
  });

  app.post('/vendor/push-token', async (request) => {
    const body = pushTokenSchema.parse(request.body);
    return pushService.register({
      vendorId: vendorIdFrom(request),
      token: body.token,
      platform: body.platform ?? null,
    });
  });

  app.get('/vendor/forecast/tomorrow', async (request) => {
    const vendor = await orderService.vendorById(vendorIdFrom(request));
    requireFeature(vendor.tier, 'next_day_prep');
    return forecastService.tomorrow(vendor);
  });

  app.post('/vendor/promptpay-qr', async (request) => {
    const vendor = await orderService.vendorById(vendorIdFrom(request));
    const body = promptpayQrSchema.parse(request.body);

    if (!vendor.promptpayId) {
      return {
        total: body.amount,
        promptpayPayload: null,
        promptpayQrDataUrl: null,
      };
    }

    try {
      const payload = promptPayPayload(vendor.promptpayId, body.amount);
      return {
        total: body.amount,
        promptpayPayload: payload,
        promptpayQrDataUrl: await QRCode.toDataURL(payload, {
          color: {
            dark: '#000000',
            light: '#ffffff',
          },
          errorCorrectionLevel: 'Q',
          margin: 4,
          width: 480,
        }),
      };
    } catch {
      return {
        total: body.amount,
        promptpayPayload: null,
        promptpayQrDataUrl: null,
      };
    }
  });

  /** Cold start and full resync. */
  app.get('/vendor/orders', async (request) => {
    const vendorId = vendorIdFrom(request);
    const vendor = await orderService.vendorById(vendorId);
    return orderService.today(vendorId, vendor.timeZone);
  });

  app.get('/vendor/menu', async (request) =>
    menuService.menuFor(vendorIdFrom(request)),
  );

  app.get('/vendor/stream', async (request, reply) => {
    const vendorId = vendorIdFrom(request);
    const since = lastEventId(request);

    const stream = sseHandler(request, reply);
    // Replay first, then go live. A vendor who reconnects after a dead spot
    // gets the orders that arrived while they were gone.
    for (const event of await orderService.eventsSince(vendorId, since)) {
      stream.send(event);
    }
    const unsubscribe = broker.subscribe(vendorId, (event) => stream.send(event));
    stream.onClose(unsubscribe);
  });

  app.post<{ Params: { id: string } }>(
    '/vendor/orders/:id/accept',
    async (request) =>
      orderService.advance({
        vendorId: vendorIdFrom(request),
        orderId: request.params.id,
        to: 'accepted',
      }),
  );

  app.post<{ Params: { id: string } }>(
    '/vendor/orders/:id/ready',
    async (request) =>
      orderService.advance({
        vendorId: vendorIdFrom(request),
        orderId: request.params.id,
        to: 'ready',
      }),
  );

  app.post<{ Params: { id: string } }>(
    '/vendor/orders/:id/complete',
    async (request) => {
      const body = completeOrderSchema.parse(request.body);
      return orderService.advance({
        vendorId: vendorIdFrom(request),
        orderId: request.params.id,
        to: 'completed',
        paymentMethod: body.paymentMethod,
      });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/vendor/orders/:id/cancel',
    async (request) =>
      orderService.advance({
        vendorId: vendorIdFrom(request),
        orderId: request.params.id,
        to: 'cancelled',
      }),
  );

  /** A walk-up. The vendor taps the items, then moves it through the queue. */
  app.post('/vendor/orders', async (request, reply) => {
    const vendorId = vendorIdFrom(request);
    const body = ringUpSchema.parse(request.body);
    const vendor = await orderService.vendorById(vendorId);

    const { order, created } = await orderService.place({
      vendor,
      lines: body.lines,
      clientId: body.clientId,
      source: 'vendor',
      paymentMethod: body.paymentMethod,
    });

    reply.code(created ? 201 : 200);
    return order;
  });

  /** Sold out, or back on. */
  app.post<{ Params: { id: string }; Body: { isAvailable?: boolean } }>(
    '/vendor/menu/:id/availability',
    async (request) => {
      const vendorId = vendorIdFrom(request);
      const isAvailable = request.body?.isAvailable !== false;
      const updated = await vendorService.setItemAvailability(
        vendorId,
        request.params.id,
        isAvailable,
      );
      if (!updated) throw notFound('Menu item');
      return updated;
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/vendor/menu/:id',
    async (request) => {
      const body = menuItemUpdateSchema.parse(request.body);
      return vendorService.updateMenuItem({
        vendorId: vendorIdFrom(request),
        menuItemId: request.params.id,
        ...body,
      });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/vendor/menu/:id',
    async (request) =>
      vendorService.archiveMenuItem(vendorIdFrom(request), request.params.id),
  );

  app.get('/vendor/categories', async (request) =>
    menuService.categoriesFor(vendorIdFrom(request)),
  );

  app.post<{ Body: { nameTh: string; nameEn: string; sortOrder?: number } }>(
    '/vendor/categories',
    async (request, reply) => {
      const body = categoryInputSchema.parse(request.body);
      reply.code(201);
      return vendorService.addCategory({
        vendorId: vendorIdFrom(request),
        ...body,
      });
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/vendor/categories/:id',
    async (request) => {
      const body = categoryUpdateSchema.parse(request.body);
      return vendorService.updateCategory({
        vendorId: vendorIdFrom(request),
        categoryId: request.params.id,
        ...body,
      });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/vendor/categories/:id',
    async (request) =>
      vendorService.deleteCategory(vendorIdFrom(request), request.params.id),
  );

  app.post('/vendor/menu', async (request, reply) => {
    const body = menuItemInputSchema.parse(request.body);
    reply.code(201);
    return vendorService.addMenuItem({
      vendorId: vendorIdFrom(request),
      ...body,
    });
  });

  /** Adds a question to a dish along with its choices, in one call. */
  app.post<{ Params: { id: string } }>(
    '/vendor/menu/:id/option-groups',
    async (request, reply) => {
      const body = optionGroupInputSchema.parse(request.body);
      reply.code(201);
      return vendorService.addOptionGroup({
        vendorId: vendorIdFrom(request),
        menuItemId: request.params.id,
        ...body,
      });
    },
  );

  /**
   * A dish photo, straight off the vendor's phone. Re-encoded to a square webp
   * before it is stored, because a 12MP original would cost the customer real
   * money to download on market mobile data.
   */
  app.post<{ Params: { id: string } }>(
    '/vendor/menu/:id/image',
    async (request) => {
      const vendorId = vendorIdFrom(request);
      const file = await request.file();
      if (!file) {
        throw new HttpError(400, 'no_file', 'Attach a picture to upload');
      }

      const stored = await storeDishImage(await file.toBuffer());
      const updated = await vendorService.setImage(
        vendorId,
        request.params.id,
        stored.url,
      );
      return { imageUrl: updated.imageUrl, bytes: stored.bytes };
    },
  );

  /** Take the picture back off, rather than leaving a wrong one up. */
  app.delete<{ Params: { id: string } }>(
    '/vendor/menu/:id/image',
    async (request) => {
      const updated = await vendorService.setImage(
        vendorIdFrom(request),
        request.params.id,
        null,
      );
      return { imageUrl: updated.imageUrl };
    },
  );

  /**
   * The figures, computed from orders. No model, no key, no latency — this is
   * the report, and it is always available. The written note below is a layer
   * on top of exactly this object.
   */
  app.get('/vendor/report', async (request) => {
    const vendor = await orderService.vendorById(vendorIdFrom(request));
    const query = reportRangeSchema.parse(request.query ?? {});
    const range = reportService.resolveRange(vendor, query);
    gateRange(vendor, range);
    return reportService.facts(vendor, range);
  });

  /**
   * The same figures, written up.
   *
   * POST rather than GET because it costs money to serve, and a method that
   * proxies and prefetchers treat as safe to repeat is the wrong one for that.
   */
  app.post('/vendor/report/brief', async (request) => {
    const vendor = await orderService.vendorById(vendorIdFrom(request));
    const body = reportRangeSchema.parse(request.body ?? {});
    const range = reportService.resolveRange(vendor, body);
    gateRange(vendor, range);
    return reportService.brief(vendor, range, body.language ?? 'th');
  });

  /**
   * The assistant bubble. One question, the tail of the thread, one answer.
   *
   * Stateless on purpose: the phone holds the conversation. A chat about
   * today's takings is worth nothing tomorrow, so there is nothing to store
   * and nothing to expire.
   */
  app.post('/vendor/assistant', async (request) => {
    const vendor = await orderService.vendorById(vendorIdFrom(request));
    requireFeature(vendor.tier, 'assistant');
    const body = assistantAskSchema.parse(request.body ?? {});
    return assistantService.ask({
      vendor,
      question: body.question,
      history: body.history ?? [],
    });
  });

  /** Open or shut the stall to new customer orders. */
  app.post<{ Body: { isOpen?: boolean } }>('/vendor/open', async (request) => {
    const vendorId = vendorIdFrom(request);
    return orderService.setOpen(vendorId, request.body?.isOpen !== false);
  });
}
