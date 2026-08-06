import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { type Harness, auth, createHarness } from './harness.js';

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.reset();
});

const register = (payload: Record<string, unknown>) =>
  h.app.inject({ method: 'POST', url: '/vendor/register', payload });

describe('registering a stall', () => {
  it('claims the slug, signs the vendor in, and hands back the order link', async () => {
    const res = await register({
      name: 'Malee Som Tam',
      slug: 'malee',
      pin: '4321',
      promptpayId: '0898765432',
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().vendor.slug).toBe('malee');
    expect(typeof res.json().token).toBe('string');
    expect(res.json().orderUrl).toMatch(/\/s\/malee$/);
  });

  it('the new stall can be ordered from immediately', async () => {
    await register({ name: 'Malee', slug: 'malee', pin: '4321' });
    const res = await h.app.inject({ method: 'GET', url: '/s/malee' });
    expect(res.statusCode).toBe(200);
    expect(res.json().vendor.name).toBe('Malee');
    expect(res.json().menu).toEqual([]);
  });

  it('the token works straight away, with no separate sign-in', async () => {
    const token = (await register({ name: 'Malee', slug: 'malee', pin: '4321' }))
      .json().token;

    const res = await h.app.inject({
      method: 'GET',
      url: '/vendor/orders',
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);
  });

  it('the PIN chosen at registration is the one that signs in later', async () => {
    await register({ name: 'Malee', slug: 'malee', pin: '4321' });

    const good = await h.app.inject({
      method: 'POST',
      url: '/vendor/session',
      payload: { slug: 'malee', pin: '4321' },
    });
    const bad = await h.app.inject({
      method: 'POST',
      url: '/vendor/session',
      payload: { slug: 'malee', pin: '1111' },
    });

    expect(good.statusCode).toBe(200);
    expect(bad.statusCode).toBe(401);
  });

  it('refuses a slug another stall already took', async () => {
    const res = await register({ name: 'Copycat', slug: h.slug, pin: '4321' });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('slug_taken');
  });

  it('refuses a slug the app itself uses as a path', async () => {
    const res = await register({ name: 'Sneaky', slug: 'vendor', pin: '4321' });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('slug_reserved');
  });

  it.each([
    ['Malee Som Tam', 'spaces'],
    ['MALEE', 'capitals'],
    ['ม าลี', 'non-latin'],
    ['ab', 'too short'],
    ['-malee', 'a leading hyphen'],
  ])('refuses %s as a slug (%s)', async (slug) => {
    const res = await register({ name: 'Malee', slug, pin: '4321' });
    expect(res.statusCode).toBe(400);
  });

  it('accepts hyphens inside the slug', async () => {
    const res = await register({ name: 'Malee', slug: 'malee-som-tam', pin: '4321' });
    expect(res.statusCode).toBe(201);
  });

  it('refuses a PIN that is not 4 to 8 digits', async () => {
    expect((await register({ name: 'M', slug: 'malee', pin: '12' })).statusCode).toBe(400);
    expect((await register({ name: 'M', slug: 'malee2', pin: 'abcd' })).statusCode).toBe(400);
  });

  it('allows a stall with no PromptPay account', async () => {
    const res = await register({ name: 'Cash Only', slug: 'cashonly', pin: '4321' });
    expect(res.statusCode).toBe(201);
  });

  it('rejects malformed PromptPay at registration', async () => {
    const res = await register({
      name: 'Wrong Pay',
      slug: 'wrong-pay',
      pin: '4321',
      promptpayId: 'abc',
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('invalid_promptpay');
  });
});

describe('the stall\'s printable QR', () => {
  it('returns an SVG, which survives being printed and reprinted', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/vendor/qr',
      headers: auth(h.token),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.body).toContain('<svg');
  });

  it('encodes this stall\'s own order link', async () => {
    const token = (
      await register({ name: 'Malee', slug: 'malee', pin: '4321' })
    ).json().token;

    const res = await h.app.inject({
      method: 'GET',
      url: '/vendor/qr',
      headers: auth(token),
    });
    // Two different stalls must not produce the same code.
    const mine = await h.app.inject({
      method: 'GET',
      url: '/vendor/qr',
      headers: auth(h.token),
    });
    expect(res.body).not.toBe(mine.body);
  });

  it('returns a mobile-displayable QR card for the stall', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/vendor/qr/card',
      headers: { ...auth(h.token), host: '192.168.1.42:3000' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().orderUrl).toBe(`http://192.168.1.42:5173/s/${h.slug}`);
    expect(res.json().qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(res.json().exportDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(res.json().variants.public.orderUrl).toBe(`http://192.168.1.42:5173/s/${h.slug}`);
    expect(res.json().variants.lan.orderUrl).toBe(`http://192.168.1.42:5173/s/${h.slug}`);
    expect(res.json().variants.public.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(res.json().variants.lan.exportDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('returns a branded PNG for exporting the stall QR', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/vendor/qr/card',
      headers: { ...auth(h.token), host: '192.168.1.42:3000' },
    });

    const base64 = res.json().exportDataUrl.replace(/^data:image\/png;base64,/, '');
    const metadata = await sharp(Buffer.from(base64, 'base64')).metadata();

    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(1080);
    expect(metadata.height).toBe(1440);
  });

  it('the printable sheet names the stall without showing the raw link', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/vendor/qr/print',
      headers: auth(h.token),
    });

    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Test Stall');
    expect(res.body).not.toContain('localhost:5173');
    expect(res.body).not.toContain(`/s/${h.slug}`);
    expect(res.body).toContain('Scan to see the menu and order');
  });

  it('escapes a stall name containing markup', async () => {
    const token = (
      await register({ name: '<script>x</script>', slug: 'xss-stall', pin: '4321' })
    ).json().token;

    const res = await h.app.inject({
      method: 'GET',
      url: '/vendor/qr/print',
      headers: auth(token),
    });
    expect(res.body).not.toContain('<script>x</script>');
    expect(res.body).toContain('&lt;script&gt;');
  });

  it('needs a token', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/vendor/qr' });
    expect(res.statusCode).toBe(401);
  });
});

/** A real encoded image, so sharp has something genuine to decode. */
const samplePhoto = (width = 1200, height = 900) =>
  sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 90, b: 40 },
    },
  })
    .jpeg()
    .toBuffer();

const upload = async (itemId: string, body: Buffer, filename = 'dish.jpg') => {
  const boundary = '----khaideetest';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);

  return h.app.inject({
    method: 'POST',
    url: `/vendor/menu/${itemId}/image`,
    headers: {
      ...auth(h.token),
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.concat([head, body, tail]),
  });
};

describe('dish photos', () => {
  it('accepts a photo and puts its URL on the dish', async () => {
    const res = await upload(h.items['Pad Thai'] as string, await samplePhoto());

    expect(res.statusCode).toBe(200);
    expect(res.json().imageUrl).toMatch(/^\/uploads\/.+\.webp$/);

    const menu = await h.app.inject({ method: 'GET', url: `/s/${h.slug}` });
    const dish = menu
      .json()
      .menu.find((m: { nameEn: string }) => m.nameEn === 'Pad Thai');
    expect(dish.imageUrl).toBe(res.json().imageUrl);
  });

  /*
   * A 12MP original would cost the customer real money to download on market
   * mobile data, so the re-encode is the point of the endpoint, not a detail.
   */
  it('re-encodes a large photo down to something a phone can afford', async () => {
    const original = await samplePhoto(3000, 2000);
    const res = await upload(h.items['Pad Thai'] as string, original);

    expect(res.json().bytes).toBeLessThan(original.byteLength);
    expect(res.json().bytes).toBeLessThan(200_000);
  });

  it('serves the stored photo back', async () => {
    const url = (
      await upload(h.items['Pad Thai'] as string, await samplePhoto())
    ).json().imageUrl;

    const res = await h.app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/webp');
  });

  it('rejects a file that is not really an image, whatever it is named', async () => {
    const res = await upload(
      h.items['Pad Thai'] as string,
      Buffer.from('this is not a photograph'),
    );
    expect(res.statusCode).toBe(415);
    expect(res.json().code).toBe('not_an_image');
  });

  it('takes a wrong picture back off', async () => {
    const itemId = h.items['Pad Thai'] as string;
    await upload(itemId, await samplePhoto());

    const res = await h.app.inject({
      method: 'DELETE',
      url: `/vendor/menu/${itemId}/image`,
      headers: auth(h.token),
    });
    expect(res.json().imageUrl).toBeNull();
  });

  it('needs a token', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/vendor/menu/${h.items['Pad Thai']}/image`,
    });
    expect(res.statusCode).toBe(401);
  });
});
