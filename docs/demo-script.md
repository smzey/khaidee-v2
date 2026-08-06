# KhaiDee — 4 minute prototype walkthrough

Your slot is the working software. The problem, the market and the business
model are covered by the others — don't re-explain them. Show the thing.

Two windows, side by side, before you say a word:

- **Left** — customer phone: `http://localhost:5173/s/padaeng`
  (Chrome, device toolbar on, iPhone size)
- **Right** — vendor app: `http://localhost:8081`, already signed in as
  `padaeng` / PIN `1234`

The rule for this section: **more clicking, less talking.** Every line below is
short on purpose. If a screen is doing the work, let it.

---

## Before you start — check all six

1. **Re-run the seeder right before you present.** Today's sales stop at the
   clock, so a stall seeded this morning looks empty by the afternoon:
   `npm run seed:demo`
   It rebuilds only the `padaeng` stall — every other stall is left alone.
2. `export XAI_API_KEY=...` (or `ANTHROPIC_API_KEY`) **in the shell that runs
   the API**, then start it. The key is read at boot — exporting it afterwards
   does nothing, and the report and assistant both go quiet.
3. `npm run dev:api`, `npm run dev:order`, `npm run dev:vendor:web` all up.
4. Open the report once yourself. It caches on the figures, so the version you
   show is instant.
5. Read today's takings off the screen and write them on your hand. You quote
   the figure at 2:20 and the live order you place at 1:00 will change it.
6. If the day looks thin, don't panic — the assistant covers the week at 3:20.
   The report screen itself only ever shows today.

**Stall:** Pa Daeng Pad Thai · 29 days of history · ~1,350 orders · ฿123k all
time. Last 7 days ≈ ฿34,200 across 341 sales, up 12% on the week before.

---

## 0:00 — 0:20 · What you're looking at

**[DO]** Point left, then right.

> Customer's phone on the left. The stall's phone on the right. Same system,
> two sides. This is real data — a month of trading for one Pad Thai stall.

---

## 0:20 — 1:10 · Ordering

**[DO]** Left window. Scroll the menu grid.

> The customer scans the code on the cart and lands here. No app, no account.
> The stall's own dishes, own categories, own prices.

**[DO]** Tap a category chip — *Noodles*.

**[DO]** Tap **ผัดไทยกุ้งสด / Pad Thai with prawns**. The option sheet opens.

> Dishes ask questions. Spice level is required — you can't order a
> half-specified plate.

**[DO]** Pick *เผ็ดมาก / Thai hot*. Tick *กุ้งเพิ่ม / Extra prawns +฿30*.
Pause on the total.

> Sixty baht became ninety.

**[DO]** Add. Add a *ชาไทยเย็น / Thai iced tea* too. Open the cart. Confirm.

---

## 1:10 — 1:45 · The queue, live

**[DO]** Say nothing. Point at the right window. The order is **already
there**. Do not reload.

> No refresh. That's an open connection, not polling.

**[DO]** Tap **Accept**. Then **Food is ready**.

**[DO]** Point back at the left window — it has flipped to ready by itself.

> Both screens, same moment.

**[DO]** Point at the big queue number.

> The vendor shouts that number. It's the whole handoff, so it's the biggest
> thing on the screen.

---

## 1:45 — 2:05 · Collecting

**[DO]** Left window: the collect screen, PromptPay QR showing.

> Not a Pay button — the customer's phone can't take money. It's the amount
> owed and a PromptPay code for exactly that, into the vendor's own account.
> Or they pay cash.

**[DO]** Right window: **Collected** → cash. The order leaves the queue.

---

## 2:05 — 2:20 · Running the stall

**[DO]** Right window → **Menu**. Toggle a dish to sold out.

**[DO]** Left window: refresh. The dish is greyed and unorderable.

> Ran out of prawns. One tap, and nobody can order it.

---

## 2:20 — 2:55 · The report

**[DO]** Back → **Report**.

> Today so far.

**[DO]** Point at takings, cash vs PromptPay, then the dish ranking.

> Takings, how they were paid, and best sellers by money rather than by count —
> which is not the same list.

**[DO]** Tap **Write note**. Let it think in front of them.

**[DO]** When it lands, read the headline off the screen, then point at the
actions underneath.

> The AI wrote those words. It did not do the arithmetic — every number was
> computed from the orders first, and what the model gets handed has no numeric
> fields in it at all. It can only choose what to say about them.

**[DO]** Tap **Thai**.

> Same note, Thai. That's who actually reads it.

**[DO]** Point at **Export PDF statement** — don't tap it.

> And it prints, for anyone who needs paper.

---

## 2:55 — 3:35 · Asking it things

**[DO]** Tap the blue **ถาม** bubble, bottom right.

**[DO]** Tap *"What sells best?"*. Wait.

**[DO]** Point at the small grey line: *Read from your figures*.

> It doesn't know anything about this stall. To say a number it has to go and
> fetch it, and that line says where it looked.

**[DO]** Type: **"was this week better than last week?"** Send.

> The report screen only shows today. This can go wider — it pulls both weeks
> and compares them.

**[DO]** Read the answer off the screen. It should be around ฿34,000 for the
week, up about 12%.

---

## 3:35 — 4:00 · The rest, quickly

**[DO]** Back. Scroll the launch pad. Tap through fast — don't linger.

**[DO]** **QR Code** — the printable stall code.

> This is what gets taped to the cart.

**[DO]** **Forecasting** — tomorrow's weather and prep.

> Tomorrow's weather against what they normally sell, so they know what to prep
> tonight.

**[DO]** **History** — the day's completed orders.

**[DO]** Stop clicking. Look up.

> Customer orders, vendor cooks, money lands, and at the end of the day the
> stall gets an honest answer about its own business. All of that is running
> right now.

---

## If something breaks

| What | Do this |
|---|---|
| **Write note** errors or does nothing | The API booted without a provider key. Show the figures — they need no key — and say the written version sits on top of exactly these numbers. Then skip to the assistant beat only if the key is actually set; otherwise go straight to 3:35. |
| Today looks empty | You seeded this morning and it's now afternoon. Re-run the seeder — it fills the day up to the current clock. |
| Assistant is slow | Fill it: "it's going and fetching the figures rather than making them up — that's the round trip." |
| Order doesn't appear on the vendor side | Reload the vendor window once. Don't narrate it. Recovery is fine; apologising is not. |
| Anything else | Move to the next beat. Never debug in front of the room. |

---

## If they ask

**"Is this a real backend or a mockup?"**
Real. Postgres, live connections both ways, a month of orders in the database.
Nothing on screen is hardcoded.

**"Could someone change the price in the browser?"**
No. The phone sends dish ids and quantities, never a price. The server prices
every order from its own menu.

**"Is the AI making those numbers up?"**
It can't. It gets tools, not the database, and the figures come back already
computed. Ask it something it has no tool for and it says so.

**"Does it work on a real phone?"**
The customer side does — it's a web page. The vendor app is Expo and runs in a
browser today; it hasn't been on a handset yet.
