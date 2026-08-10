# Postgres Backup And Restore Runbook

Use this when setting up production backups, taking an emergency backup, or
rehearsing a restore for KhaiDee.

KhaiDee currently manages schema with `drizzle-kit push`; there are no migration
files and no `drizzle/` history directory. A production dump is therefore the
recoverable history for both schema and data.

## Requirements

- Production Postgres must have automated daily backups enabled by the hosting
  provider.
- Backups must be stored outside the API host.
- Point-in-time recovery should be enabled when the provider supports it.
- A restore rehearsal must run before the first real production pilot and after
  any database-provider move.

## Emergency Backup

Run this from a machine with `pg_dump` and network access to production:

```bash
export DATABASE_URL='postgres://...production...'
mkdir -p backups
pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file "backups/khaidee-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

Move the dump to offsite storage immediately. Do not leave the only copy on the
API box or a laptop.

## Restore Rehearsal

Never rehearse against production. Create a fresh non-production database:

```bash
createdb khaidee_restore_rehearsal
export RESTORE_DATABASE_URL='postgres://localhost:5432/khaidee_restore_rehearsal'
pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --dbname "$RESTORE_DATABASE_URL" \
  backups/khaidee-YYYYMMDDTHHMMSSZ.dump
```

## Verification

After restore, verify the core tables exist and contain plausible data:

```bash
psql "$RESTORE_DATABASE_URL" -c "\dt"
psql "$RESTORE_DATABASE_URL" -c "select count(*) as vendors from vendors;"
psql "$RESTORE_DATABASE_URL" -c "select count(*) as orders from orders;"
psql "$RESTORE_DATABASE_URL" -c "select max(placed_at) as latest_order from orders;"
```

Then point a local API process at the restored database:

```bash
DATABASE_URL="$RESTORE_DATABASE_URL" npm run dev:api
curl -fsS http://localhost:3000/ready
```

The readiness response must be:

```json
{"ok":true,"database":"ok"}
```

## Restore To Production

Only restore to production when the current production database is known bad or
the provider has created a replacement database for recovery.

1. Stop API writes or put the service into maintenance at the hosting layer.
2. Take one final emergency backup of the current production database.
3. Restore the selected dump into the replacement database.
4. Run the verification queries above.
5. Start one API instance against the restored database.
6. Confirm `GET /ready` returns 200.
7. Confirm one vendor can sign in and load today's queue.
8. Re-enable normal traffic.

## Escalation

If restore fails:

- Keep the failed restored database for inspection.
- Do not overwrite the source dump.
- Capture the exact `pg_restore` error output.
- Check provider backup status and point-in-time recovery options.
- Escalate before retrying against production.
