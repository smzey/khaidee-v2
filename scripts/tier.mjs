#!/usr/bin/env node
/**
 * Moves a stall between plans.
 *
 * There is no payment gateway, so this is how an upgrade actually happens
 * today: by hand, on purpose. It talks to the database rather than the API
 * because there is deliberately no route that lets a stall promote itself.
 *
 *   npm run tier                                  list every stall and its plan
 *   npm run tier -- --slug somchai --set pro
 *   npm run tier -- --slug somchai --set free
 */
import postgres from 'postgres';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith('--')) continue;
  const next = process.argv[i + 1];
  if (next && !next.startsWith('--')) {
    args.set(arg.slice(2), next);
    i += 1;
  } else {
    args.set(arg.slice(2), 'true');
  }
}

const TIERS = ['free', 'pro', 'premium'];
const URL =
  args.get('database') ??
  process.env.DATABASE_URL ??
  'postgres://localhost:5432/khaidee_dev';

const sql = postgres(URL);
const slug = args.get('slug');
const set = args.get('set');

try {
  if (!set) {
    const rows = await sql`
      select slug, name, tier from vendors order by created_at
    `;
    if (rows.length === 0) {
      console.log('No stalls yet. Register one first.');
    } else {
      const width = Math.max(...rows.map((row) => row.slug.length));
      for (const row of rows) {
        console.log(
          `  ${row.slug.padEnd(width)}  ${row.tier.padEnd(8)}  ${row.name}`,
        );
      }
    }
    await sql.end();
    process.exit(0);
  }

  if (!slug) {
    console.error('Which stall? Pass --slug <stall>.');
    process.exit(1);
  }

  if (!TIERS.includes(set)) {
    console.error(`--set must be one of: ${TIERS.join(', ')}`);
    process.exit(1);
  }

  const [row] = await sql`
    update vendors set tier = ${set} where slug = ${slug}
    returning slug, name, tier
  `;

  if (!row) {
    console.error(`No stall with slug "${slug}".`);
    process.exit(1);
  }

  console.log(`${row.name} (${row.slug}) is now on ${row.tier}.`);
} finally {
  await sql.end();
}
