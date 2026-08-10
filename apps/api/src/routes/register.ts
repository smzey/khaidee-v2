import { registerVendorSchema } from '@khaidee/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { networkInterfaces } from 'node:os';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { bearer, issueToken, readToken, tokenMatchesPin } from '../lib/auth.js';
import { tierSummary } from '../lib/entitlements.js';
import { unauthorized } from '../lib/errors.js';
import type { OrderService } from '../services/orders.js';
import type { VendorService } from '../services/vendors.js';

/** Where a customer's phone should land. Set per deployment. */
const PUBLIC_ORDER_URL =
  process.env.PUBLIC_ORDER_URL ?? 'http://localhost:5173';

function isLocalHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
}

function isLocalUrl(url: string): boolean {
  try {
    return isLocalHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

function lanAddress(): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return null;
}

type QrMode = 'public' | 'lan';

interface QrCardVariant {
  label: string;
  orderUrl: string;
  qrDataUrl: string;
  exportDataUrl: string;
}

function publicOrderUrlFor(slug: string): string | null {
  if (process.env.PUBLIC_ORDER_URL && !isLocalUrl(process.env.PUBLIC_ORDER_URL)) {
    return `${PUBLIC_ORDER_URL}/s/${slug}`;
  }

  return null;
}

function lanOrderUrlFor(request: FastifyRequest, slug: string): string {
  const host = request.headers.host?.replace(/:\d+$/, '');
  if (host && !isLocalHost(host) && !host.endsWith('ngrok-free.app')) {
    return `http://${host}:5173/s/${slug}`;
  }

  const lan = lanAddress();
  return `http://${lan ?? 'localhost'}:5173/s/${slug}`;
}

function requestedQrMode(request: FastifyRequest): QrMode {
  const query = request.query;
  if (query && typeof query === 'object' && 'mode' in query && query.mode === 'lan') {
    return 'lan';
  }
  return 'public';
}

function orderUrlFor(request: FastifyRequest, slug: string, mode: QrMode = 'public'): string {
  if (mode === 'lan') return lanOrderUrlFor(request, slug);
  return publicOrderUrlFor(slug) ?? lanOrderUrlFor(request, slug);
}

function qrLabelFor(mode: QrMode, url: string): string {
  if (mode === 'lan') return 'LAN';
  return new URL(url).hostname.endsWith('ngrok-free.app') ? 'Ngrok' : 'Public';
}

async function qrCardVariant(params: {
  mode: QrMode;
  name: string;
  orderUrl: string;
}): Promise<QrCardVariant> {
  const qrDataUrl = await QRCode.toDataURL(params.orderUrl, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 640,
  });
  const exportDataUrl = await brandedQrCardDataUrl({
    name: params.name,
    url: params.orderUrl,
  });

  return {
    label: qrLabelFor(params.mode, params.orderUrl),
    orderUrl: params.orderUrl,
    qrDataUrl,
    exportDataUrl,
  };
}

export function registerRoutes(
  app: FastifyInstance,
  vendorService: VendorService,
  orderService: OrderService,
): void {
  const vendorFrom = async (request: FastifyRequest) => {
    const token = readToken(bearer(request.headers.authorization));
    const vendor = await orderService.vendorById(token.vendorId);
    if (!tokenMatchesPin(token.pinVersion, vendor.pinHash)) throw unauthorized();
    return vendor;
  };

  /**
   * Claims a stall and signs the vendor straight in — there is no confirmation
   * step to lose someone at, because the next thing they need is their QR.
   */
  app.post('/vendor/register', async (request, reply) => {
    const body = registerVendorSchema.parse(request.body);
    const vendor = await vendorService.register(body);

    reply.code(201);
    return {
      token: issueToken(vendor.id, vendor.pinHash),
      vendor: {
        id: vendor.id,
        slug: vendor.slug,
        name: vendor.name,
        promptpayId: vendor.promptpayId,
        isOpen: vendor.isOpen,
        tier: vendor.tier,
      },
      plan: tierSummary(vendor.tier),
      orderUrl: orderUrlFor(request, vendor.slug),
    };
  });

  /**
   * The stall's QR, as an SVG the vendor can print and tape to the cart.
   *
   * SVG rather than PNG because this gets printed, sometimes enlarged onto A4,
   * and a raster QR photographs badly once it has been through a cheap printer
   * twice.
   */
  app.get('/vendor/qr', async (request, reply) => {
    const vendor = await vendorFrom(request);
    const url = orderUrlFor(request, vendor.slug, requestedQrMode(request));

    const svg = await QRCode.toString(url, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
    });

    reply.header('content-type', 'image/svg+xml');
    return svg;
  });

  app.get('/vendor/qr/card', async (request) => {
    const vendor = await vendorFrom(request);
    const publicCard = await qrCardVariant({
      mode: 'public',
      name: vendor.name,
      orderUrl: orderUrlFor(request, vendor.slug, 'public'),
    });
    const lanCard = await qrCardVariant({
      mode: 'lan',
      name: vendor.name,
      orderUrl: orderUrlFor(request, vendor.slug, 'lan'),
    });

    return {
      vendor: {
        id: vendor.id,
        slug: vendor.slug,
        name: vendor.name,
      },
      orderUrl: publicCard.orderUrl,
      qrDataUrl: publicCard.qrDataUrl,
      exportDataUrl: publicCard.exportDataUrl,
      variants: {
        public: publicCard,
        lan: lanCard,
      },
    };
  });

  /** The same QR with the stall's name, sized to print on a single sheet. */
  app.get('/vendor/qr/print', async (request, reply) => {
    const vendor = await vendorFrom(request);
    const url = orderUrlFor(request, vendor.slug, requestedQrMode(request));

    const qr = await QRCode.toString(url, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 0,
    });

    reply.header('content-type', 'text/html; charset=utf-8');
    return printableSheet({ name: vendor.name, qr });
  });
}

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] as string,
  );

const trunc = (value: string, max: number) => {
  const characters = Array.from(value.trim());
  if (characters.length <= max) return value.trim();
  return `${characters.slice(0, Math.max(0, max - 3)).join('')}...`;
};

function wrapText(value: string, maxCharacters: number, maxLines: number): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [''];

  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (Array.from(next).length <= maxCharacters) {
      current = next;
      continue;
    }

    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) break;
  }

  if (current && lines.length < maxLines) lines.push(current);
  const leftover = words.slice(lines.join(' ').split(/\s+/).filter(Boolean).length);
  if (leftover.length && lines.length) {
    lines[lines.length - 1] = trunc(`${lines[lines.length - 1]} ${leftover.join(' ')}`, maxCharacters);
  }

  return lines.map((line) => trunc(line, maxCharacters));
}

function textRows(
  lines: string[],
  params: {
    x: number;
    y: number;
    size: number;
    lineHeight: number;
    weight?: number;
    color?: string;
    anchor?: 'start' | 'middle';
    family?: string;
  },
) {
  return lines
    .map(
      (line, index) =>
        `<text x="${params.x}" y="${params.y + index * params.lineHeight}" text-anchor="${params.anchor ?? 'middle'}" font-family="${params.family ?? 'Arial, Helvetica, sans-serif'}" font-size="${params.size}" font-weight="${params.weight ?? 700}" fill="${params.color ?? '#16181C'}">${escape(line)}</text>`,
    )
    .join('');
}

async function brandedQrCardDataUrl(params: { name: string; url: string }) {
  const width = 1080;
  const height = 1440;
  const qrSize = 720;
  const qrLeft = (width - qrSize) / 2;
  const qrTop = 390;
  const titleLines = wrapText(params.name, 24, 2);
  const year = new Date().getFullYear();
  const qr = await QRCode.toBuffer(params.url, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: qrSize,
  });
  const card = Buffer.from(`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" fill="#FBFAF7"/>
  <rect x="72" y="72" width="936" height="1296" rx="28" fill="#FFFFFF" stroke="#16181C" stroke-width="6"/>
  <text x="540" y="160" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="800" letter-spacing="8" fill="#1B4FD8">KHAIDEE</text>
  ${textRows(titleLines, { x: 540, y: titleLines.length > 1 ? 240 : 270, size: 68, lineHeight: 76, weight: 900 })}
  <text x="540" y="340" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="32" font-weight="700" fill="#55585F">Scan to order from this stall</text>
  <rect x="${qrLeft - 24}" y="${qrTop - 24}" width="${qrSize + 48}" height="${qrSize + 48}" rx="20" fill="#FFFFFF" stroke="#D9D5CC" stroke-width="4"/>
  <text x="540" y="1218" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="800" fill="#55585F">Menu and ordering, powered by Khaidee</text>
  <text x="540" y="1320" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="800" letter-spacing="3" fill="#16181C" opacity="0.34">COPYRIGHT ${year} KHAIDEE</text>
</svg>`);

  const image = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 251, g: 250, b: 247, alpha: 1 },
    },
  })
    .composite([
      { input: card, top: 0, left: 0 },
      { input: qr, top: qrTop, left: qrLeft },
    ])
    .png()
    .toBuffer();

  return `data:image/png;base64,${image.toString('base64')}`;
}

/**
 * Deliberately plain: black on white, no photographs, no tints. This gets
 * printed on whatever machine is to hand and then lives outdoors on a cart,
 * and a QR that has been through a low-toner printer still has to scan.
 */
function printableSheet(params: { name: string; qr: string }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escape(params.name)} — order code</title>
<style>
  @page { margin: 14mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; display: flex; flex-direction: column; align-items: center;
    justify-content: center; min-height: 100vh; text-align: center;
    font-family: ui-sans-serif, system-ui, sans-serif; color: #000;
    background: #fff;
  }
  .stall { font-size: 34px; font-weight: 800; letter-spacing: -0.02em; margin: 0 0 6px; }
  .lead { font-size: 20px; margin: 0 0 26px; }
  .qr { width: 108mm; height: 108mm; }
  .qr svg { width: 100%; height: 100%; display: block; }
  .foot { margin-top: 30px; font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; }
  @media print { .noprint { display: none; } }
</style>
</head>
<body>
  <h1 class="stall">${escape(params.name)}</h1>
  <p class="lead">Scan to see the menu and order</p>
  <div class="qr">${params.qr}</div>
  <p class="foot">KhaiDee</p>
  <button class="noprint" onclick="print()" style="margin-top:24px;padding:12px 20px;font-size:15px">Print this</button>
</body>
</html>`;
}
