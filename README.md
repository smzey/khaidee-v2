# KhaiDee v2

A tap-to-order POS for Thai street vendors. Where v1 was one Expo app talking
to AsyncStorage, v2 is a two-sided system: customers order by scanning a QR at
the stall, and the vendor works a live queue.

## What's built

| Package | State |
|---|---|
| `packages/domain` | Done — 172 tests |
| `apps/api` | Done — 186 integration tests |
| `apps/order` | Done — 44 component tests |
| `apps/vendor` | Queue works — 42 tests, never run on a real handset |

## Run it

```bash
npm install
createdb khaidee_dev
npm run db:push          # apply the schema
npm run db:seed          # one stall: /s/somchai, PIN 1234
npm run dev:api          # :3000
npm run dev:order        # :5173 — the customer page
npm run dev:vendor       # :8081 — the stall app, via Expo Go
```

Testing on a real phone, on the same wifi:

```bash
npm run qr               # both codes
npm run qr:order         # customer page only
npm run qr:vendor        # Expo Go link only
```

## Three different QR codes

They are easy to confuse, so:

| Code | What it is | Lifetime |
|---|---|---|
| `GET /vendor/qr/print` | **The real one.** The stall's own code, from registration. Printed and taped to the cart. | Permanent |
| `npm run qr:order` | The customer page on this laptop's LAN address | Until the laptop sleeps |
| `npm run qr:vendor` | An `exp://` link that loads the vendor app into Expo Go | Development only |

Only the first is part of the product. A vendor never scans anything to use
their own app — a shipped app is installed. The other two exist so a phone can
reach a laptop during development.

```bash
npm test                 # 248 tests
npm run typecheck
```

Integration tests need a second database:

```bash
createdb khaidee_test
DATABASE_URL=postgres://localhost:5432/khaidee_test npx drizzle-kit push --force
```

## Shape

```
packages/domain/   pure TS, zero framework imports — imported by all three apps
apps/api/          Fastify 5 + Drizzle + Postgres, SSE for both sides
apps/order/        Vite + React, the page a QR opens — done
apps/vendor/       Expo, the stall phone
```

**The server owns pricing.** A client sends item ids and quantities; it never
sends a price. `apps/api` imports `cartTotal` from `@khaidee/domain` and
reprices every order from its own menu, so a tampered or stale page cannot buy
a ฿60 plate for ฿1. There is a test that tries.

**Order lines snapshot the price and the name they sold under**, carried over
from v1's best instinct — editing the menu tomorrow must not rewrite what
today's receipt said. Menu items are archived, never deleted, for the same
reason.

## The order loop

```
                 ┌──────────────────────────────────┐
  customer  ─▶  PLACED ──▶ ACCEPTED ──▶ READY ──▶ COMPLETED
                    │          │           │
                    └──────────┴───────────┴──▶ CANCELLED

  vendor ring-up ──────────────────────────────▶ COMPLETED
```

A walk-up the vendor taps in is born `COMPLETED` — the money was taken at the
counter before the record existed. Both paths land in the same `orders` table,
so the day's takings are one query no matter how the sale arrived.

`COMPLETED` requires a payment method. That is a database check constraint,
not a convention, so it holds even if a future route forgets.

## Menu shape

```
vendor ─┬─ categories        "Noodles", "Rice dishes", "Drinks" — vendor-defined
        └─ menu_items ─┬─ image_url      a photo, or a placeholder tile
                       └─ option_groups ─── options
```

An **option group** is a question the dish asks, and its rule is two numbers
rather than a type field:

| min | max | means | renders as |
|---|---|---|---|
| 1 | 1 | spice level — pick exactly one, required | radios |
| 0 | 1 | pick one, or none | radios |
| 0 | 3 | add-ons — pick up to three | checkboxes |
| 2 | 3 | pick two or three | checkboxes |

The client renders radios when `maxSelect` is 1 and checkboxes otherwise; the
server validates against the same two numbers. A dish whose required group was
skipped is refused with `409`, so a client that ignores its own rules still
cannot buy a half-specified dish.

Each option carries a `priceDelta` added to the dish price — zero for "mild",
`+฿30` for prawns. **Options are priced server-side like everything else**: the
request carries option ids, never prices.

The same dish with different options is a different cart line, which is why the
cart is a list of entries rather than a map from dish to quantity. Identical
picks stack; "Pad Thai, extra egg" and "Pad Thai, Thai hot" do not.

## Dish photos

`POST /vendor/menu/:id/image` takes whatever the vendor's phone produced and
re-encodes it to an 800px square webp. A 3000×2000 JPEG at 71KB comes back at
around 6KB — which matters, because the customer is loading this on market
mobile data while standing at the stall.

Going through sharp is also the validation: a file that is not really an image
fails to decode, so nothing is trusted on the strength of its name or its
content-type header. Dishes with no photo get a tinted placeholder tile.

## Registering a stall

```
POST /vendor/register    name, slug, pin, promptpayId?
                         -> token + orderUrl, signed in immediately
GET  /vendor/qr          the stall's QR as SVG
GET  /vendor/qr/print    a printable sheet: stall name + QR + the link in text
```

The slug is the whole identity of the QR, so it is checked against reserved
paths and against stalls that already exist — a taken slug is a plain `409`,
because the vendor is standing there choosing a name. SVG rather than PNG
because this gets printed, sometimes enlarged onto A4, and a raster QR
photographs badly after a cheap printer has had it twice.

## The customer flow

```
scan QR ──▶ select menu ──▶ confirm ──▶ wait ──▶ collect & pay
GET /s/:slug   local cart    POST orders   SSE      GET payment
```

The customer's phone cannot take a payment, so the last screen is not a Pay
button. It shows the queue number, the amount owed, and a PromptPay QR for
exactly that amount into the vendor's own account. The customer pays from their
banking app or hands over cash; the vendor confirms and taps complete.

**The queue number is the handoff.** The vendor calls "order fourteen" — if the
waiting screen doesn't make `#14` the biggest thing on it, the customer and the
vendor cannot find each other.

**A customer may cancel only while the order is still `placed`.** Once the stall
accepts, the ingredients are committed and cancelling becomes the vendor's call.
Cancelling needs the `clientId` the browser generated, not just the order id —
knowing an order id is not proof of owning it. Queue numbers are never reused.

## Two things that look over-engineered and are not

**Queue numbers are allocated under a per-stall, per-day advisory lock.** The
obvious version — read `max(queue_no)`, insert, retry on conflict — thunders:
every simultaneous order reads the same max, one wins, the rest retry into
each other, and the last order in a burst can exhaust its retries and fail a
real customer. Both concurrency tests failed against that version before the
lock replaced it.

**Every write carries a client-generated `clientId`**, unique per vendor. A
double tap, a resend on flaky 4G, and the vendor app's offline outbox replaying
after a dead spot all resolve to the same order rather than three.

## SSE, not polling

Both sides hold a `text/event-stream`. Every frame carries its `id:`, which the
client returns as `Last-Event-ID` on reconnect; the server replays from the
`order_events` table. A vendor who walks behind a concrete pillar gets the
orders that arrived while they were gone, rather than silently missing them.

Fan-out is in-process (`lib/broker.ts`). Durability is the table, not the
broker, so restarting the API costs nothing. Running more than one instance
later means swapping the broker for Postgres `LISTEN/NOTIFY` — nothing else
changes.

## API

```
GET  /s/:slug                          stall + menu (the QR target)
POST /s/:slug/orders                   place — 201 new, 200 retry
GET  /orders/:id                       poll fallback
GET  /orders/:id/stream                customer watches their own order
GET  /orders/:id/payment               amount owed + PromptPay payload
POST /orders/:id/cancel                customer cancels, while still `placed`

POST /vendor/session                   slug + PIN -> signed token
GET  /vendor/orders                    today's queue (cold start / resync)
GET  /vendor/stream                    live queue, replays from Last-Event-ID
POST /vendor/orders                    ring up a walk-up
POST /vendor/orders/:id/accept|ready|complete|cancel
POST /vendor/menu/:id/availability     sold out, or back on
POST /vendor/open                      open or shut the stall

POST /vendor/register                  claim a stall, get a token
GET  /vendor/qr | /vendor/qr/print     the stall's code, SVG or printable
GET  /vendor/categories                the stall's headings
POST /vendor/categories                add one
POST /vendor/menu                      add a dish
POST /vendor/menu/:id/option-groups    add a question and its choices
POST /vendor/menu/:id/image            upload a dish photo
DELETE /vendor/menu/:id/image          take a wrong photo back off

GET  /vendor/plans                     the plans, and which one this stall is on
GET  /vendor/report                    the figures — today is free, ranges are Pro
POST /vendor/report/brief              the same figures, written up
POST /vendor/assistant                 ask anything about the stall (Pro)
```

Errors are `{ code, message, details }`. `409 items_unavailable` names what
sold out so the page can say "Pad Thai just sold out" and keep the rest of the
cart. `423 stall_closed` when the stall is not taking orders.

## Plans

| | Free | Pro | Premium |
|---|---|---|---|
| | ฿0 | ฿299 / month | ฿1,700 / month |
| | Record your business | Understand it with AI | Improve it with an expert |
| Sales, queue, menu, QR | ✓ | ✓ | ✓ |
| Inventory and low-stock alerts | ✓ | ✓ | ✓ |
| Today's written report | ✓ | ✓ | ✓ |
| History and date ranges | | ✓ | ✓ |
| Weather and next-day prep | | ✓ | ✓ |
| The assistant | | ✓ | ✓ |
| 1:1 expert matching | | | ✓ |

The whole scheme is one table — `FEATURES` in `packages/domain/src/tiers.ts` —
mapping each capability to the cheapest tier that includes it. The API gates on
it, the app renders its plans screen from it, and moving a feature between tiers
is a one-line change there and nowhere else.

**Today's report is free on purpose.** It is the free tier's entire argument for
paying: a vendor who has never seen one has no reason to believe it is worth
฿299. History and comparison are what Pro sells, so anything that is not today
is gated.

Gating is enforced server-side. A refused request is `402 upgrade_required` —
not 403, because nothing is wrong with the request or the vendor, and the client
should show a price rather than an error:

```json
{ "code": "upgrade_required",
  "details": { "feature": "assistant", "currentTier": "free",
               "requiredTier": "pro", "price": 299 } }
```

The app never dead-ends on this. The assistant bubble stays visible on Free and
opens an upsell instead of a chat — a feature a vendor never sees is one they
never buy.

**There is no payment gateway.** Upgrades happen by hand, which is why the only
way to move a stall is a script that talks to the database directly — there is
deliberately no route by which a stall can promote itself:

```bash
npm run tier                                   # every stall and its plan
npm run tier -- --slug somchai --set pro
```

## The assistant

A bubble that follows the vendor across the app. Ask it anything about the
stall and it answers from the stall's own orders.

It is a **tool-using loop, not a chat with the data pasted in**, and that is the
whole design. The model starts every conversation knowing nothing about this
stall. To say a number it has to call a tool, and what comes back was computed
by `packages/domain` from real orders. There is no path by which it can arrive
at a figure of its own — so the worst case is "I cannot answer that" rather than
a confident wrong number the vendor acts on.

| Tool | Answers |
|---|---|
| `get_today` | the date on the stall's clock — the model has no clock |
| `get_report` | takings, dishes, options, hours, service times, movement |
| `compare_periods` | two ranges side by side |
| `get_menu` | dishes, prices, what is sold out, option prices |
| `get_queue_now` | what is on the counter this minute |

Every tool is bound to the caller's own stall on the server side. The model
never supplies a vendor id and cannot reach another stall by asking.

```
POST /vendor/assistant   { question, history? } -> { reply, toolCalls, usage }
```

Stateless: the phone holds the thread and sends back the tail. There is no
conversation table, because a chat about today's takings is worth nothing
tomorrow. The answer carries `toolCalls`, and the bubble prints "Read from your
figures" underneath — the vendor should be able to tell an answer from a guess.

Capped at 5 tool rounds and 12 history turns per message, and `effort` defaults
to `low`: the work is picking a tool and reading figures that are already
correct, and the vendor is waiting with a wet hand on a phone.
`KHAIDEE_ASSISTANT_MODEL` and `KHAIDEE_ASSISTANT_EFFORT` override the defaults.

## The report

Two layers, and the split between them is the whole design.

`packages/domain/src/report.ts` computes every figure — takings, dish ranking,
option attach rates, hours, service times, movement against the period before —
as pure functions over orders, in whole baht. No model is involved, and no model
is ever asked to do arithmetic. An LLM that writes a clumsy sentence is a
clumsy sentence; an LLM that miscounts takings is a vendor who cannot reconcile
their cash box.

`apps/api/src/lib/narrator.ts` then hands those computed figures to
`claude-opus-5` and asks only for words: a headline, a summary, what went well,
what to watch, and one to three things to actually do. The response is
constrained by a schema, so it cannot come back as free prose, and it contains
no numeric fields at all — every number in the note was copied from figures that
were already true. `GET /vendor/report` returns those figures on their own and
never needs a key.

```bash
cp .env.example .env
# template notes work by default
# later, set KHAIDEE_REPORT_AI=true and add XAI_API_KEY for Grok
npm run dev:api

npm run report -- --slug somchai --pin 1234              # today, in Thai
npm run report -- --slug somchai --pin 1234 --lang en
npm run report -- --slug somchai --pin 1234 --from 2026-08-01 --to 2026-08-07
npm run report -- --slug somchai --pin 1234 --facts-only # skip the model
```

Guards, because this one costs money per call:

- Below three completed orders it does not write at all, and says so. A
  narrative off two sales is invention dressed as insight.
- Briefs are cached on the figures themselves, so reopening the report is free
  and a late order invalidates it automatically.
- Ranges are capped at 92 days.
- `KHAIDEE_REPORT_MODEL` and `KHAIDEE_REPORT_EFFORT` override the defaults
  (`claude-opus-5`, `medium`).

## Carried over from v1, and left behind

Ported: `money`, `cart`, `dates`, and the types, all still framework-free.

Landed differently: v1's analytics suite is now `report.ts` plus the written
brief above, computed from real orders rather than estimated.

Left in v1 for now: the yield gap and the PDF export.

## Known limits

- Vendor sign-in is a per-stall PIN, not accounts. The token is HMAC-signed and
  stateless; `SESSION_SECRET` must be set before this is deployed anywhere.
- The seed is one stall and a real menu — deliberately no generated history.
- `apps/vendor` has only ever run in a browser via react-native-web. It has
  never been opened on a real iOS or Android handset.
- The report has no screen yet. It is reachable by API and by `npm run report`.
- **The PromptPay payloads have not been scanned by a real banking app.** The
  structure, the field encoding and the CRC are unit-tested — including against
  the published `0x29B1` check value for CRC-16/CCITT-FALSE — but that proves
  the payload is well-formed, not that a bank accepts it. Scan one with a real
  app before trusting it with money.
- Photos are stored on the API's own disk under `uploads/`. Fine for one box;
  a second instance needs S3 or a shared volume.
- **The written report has never run against the real Anthropic API.** There
  was no key on the machine it was built on. The figures, the schema, the
  caching, the thin-day guard and the no-key path are all covered by tests
  against a stub narrator; the one untested step is the HTTP call itself. Set
  `ANTHROPIC_API_KEY` and run `npm run report` to close that gap.
- **The assistant has never run against a real model either.** Its tool layer
  and route are covered by tests, and the xAI branch of the agent loop was
  driven end to end against a local mock speaking the OpenAI tool-calling
  protocol — two rounds, real tools, real figures. The Anthropic branch has not
  been exercised at all. Point a key at it before trusting it.
- The report reads whatever the orders say. A day where the vendor forgot to
  record payment method shows up as `payment.unrecorded`, and the brief will
  say so rather than quietly reallocating it to cash.
- Nothing stops a passer-by placing orders they never collect. The vendor's
  accept step is the only gate, and it cannot tell a real order from a fake
  one. A per-device cap on open orders was considered and deliberately left
  out for now.
