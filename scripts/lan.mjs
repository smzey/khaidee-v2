import { networkInterfaces } from 'node:os';
import QRCode from 'qrcode';

/**
 * Development QR codes for testing on a real phone.
 *
 * Neither of these is the code a vendor tapes to their cart. That one is
 * generated from the stall's registration and printed from
 * `GET /vendor/qr/print` — it points at a deployed URL and never changes.
 * These two point at this laptop and stop working the moment it sleeps.
 *
 * The phone cannot reach the API at `localhost`, because on the phone that IS
 * the phone. Both apps have to talk to this machine's LAN address.
 */
function lanAddress() {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return null;
}

const host = lanAddress();
if (!host) {
  console.error(
    'No network address found. Connect this machine to wifi and try again.',
  );
  process.exit(1);
}

const which = (process.argv[2] ?? 'both').toLowerCase();
const slug = process.argv[3] ?? 'somchai';

const targets = {
  order: {
    title: 'CUSTOMER — the ordering page',
    url: `http://${host}:5173/s/${slug}`,
    scan: 'Scan with the phone camera. Opens in the browser, nothing to install.',
    serve: `npm run dev:api   and   VITE_API_URL=http://${host}:3000 npm run dev:order`,
  },
  vendor: {
    title: 'VENDOR — the stall app, in Expo Go',
    url: `exp://${host}:8081`,
    scan: 'Scan with Expo Go. Development only — a shipped app is installed, not scanned.',
    serve: `npm run dev:vendor    (sign in: ${slug} / 1234)`,
  },
};

const show = async (target) => {
  console.log(`\n\x1b[1m${target.title}\x1b[0m`);
  console.log(await QRCode.toString(target.url, { type: 'terminal', small: true }));
  console.log(`  ${target.url}`);
  console.log(`  ${target.scan}`);
  console.log(`  serve with: ${target.serve}`);
};

if (which === 'order' || which === 'both') await show(targets.order);
if (which === 'vendor' || which === 'both') await show(targets.vendor);

console.log(`\n  API for both: http://${host}:3000`);
console.log(
  '  The vendor app derives that from the bundler host, so there is nothing to configure.\n',
);
