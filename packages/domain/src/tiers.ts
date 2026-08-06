/**
 * What a stall has paid for.
 *
 * The whole scheme is one table — FEATURES — mapping each capability to the
 * cheapest tier that includes it. Everything else in this file reads from it,
 * the API gates on it, and the app renders its plans screen from it. Moving a
 * feature between tiers is a one-line change here and nothing else moves.
 *
 * Prices are whole baht per month, like every other figure in this codebase.
 */

export type Tier = 'free' | 'pro' | 'premium';

export const TIER_ORDER: readonly Tier[] = ['free', 'pro', 'premium'];

/**
 * Every gated capability, named for what the vendor gets rather than for the
 * route that serves it — routes get renamed, the promise does not.
 */
export type Feature =
  | 'sales_recording'
  | 'inventory_tracking'
  | 'low_stock_alerts'
  | 'basic_dashboard'
  | 'ai_report_today'
  | 'ai_report_range'
  | 'weather_insights'
  | 'next_day_prep'
  | 'assistant'
  | 'annual_health_check'
  | 'expert_matching';

/** The cheapest tier that includes each feature. */
export const FEATURES: Record<Feature, Tier> = {
  // Free — run the stall.
  sales_recording: 'free',
  inventory_tracking: 'free',
  low_stock_alerts: 'free',
  basic_dashboard: 'free',
  ai_report_today: 'free',
  ai_report_range: 'free',
  weather_insights: 'free',
  next_day_prep: 'free',
  assistant: 'free',

  // Pro — optional growth services after the core POS is proven.
  annual_health_check: 'pro',

  // Premium — a real person, matched to the stall.
  expert_matching: 'premium',
};

export interface TierPlan {
  tier: Tier;
  nameEn: string;
  nameTh: string;
  /** Whole baht per month. */
  price: number;
  taglineEn: string;
  taglineTh: string;
  /** The bullets, as the plans screen shows them. */
  linesEn: readonly string[];
  linesTh: readonly string[];
  /** Rendered as "All Free features" rather than repeating the list. */
  inherits: Tier | null;
}

export const PLANS: Record<Tier, TierPlan> = {
  free: {
    tier: 'free',
    nameEn: 'Free',
    nameTh: 'ฟรี',
    price: 0,
    taglineEn: 'Core POS for every stall',
    taglineTh: 'ระบบหลักฟรีสำหรับทุกร้าน',
    linesEn: [
      'QR customer ordering and live queue',
      'Counter ring-up with cash or PromptPay',
      'Menu, pictures, ingredients and stall settings',
      'History, reports and PDF export',
      'Forecasting with weather and prep suggestions',
      'Assistant access when AI is enabled',
    ],
    linesTh: [
      'สั่งผ่าน QR และคิวสด',
      'ขายหน้าร้านด้วยเงินสดหรือพร้อมเพย์',
      'เมนู รูปภาพ วัตถุดิบ และตั้งค่าร้าน',
      'ประวัติ รายงาน และส่งออก PDF',
      'พยากรณ์พร้อมอากาศและคำแนะนำเตรียมของ',
      'ใช้ผู้ช่วยได้เมื่อเปิด AI',
    ],
    inherits: null,
  },
  pro: {
    tier: 'pro',
    nameEn: 'Pro',
    nameTh: 'โปร',
    price: 299,
    taglineEn: 'Optional growth tools',
    taglineTh: 'เครื่องมือเสริมสำหรับโตต่อ',
    linesEn: [
      'Deeper AI business health check',
      'Longer-term trend review',
      'Prep and margin experiments',
      'Priority feedback while the product grows',
    ],
    linesTh: [
      'ตรวจสุขภาพธุรกิจด้วย AI แบบลึกขึ้น',
      'ดูแนวโน้มระยะยาว',
      'ทดลองแผนเตรียมของและกำไร',
      'ส่ง feedback ได้ก่อนระหว่างที่ระบบโต',
    ],
    inherits: 'free',
  },
  premium: {
    tier: 'premium',
    nameEn: 'Premium',
    nameTh: 'พรีเมียม',
    price: 1700,
    taglineEn: 'Improve your business with a real expert',
    taglineTh: 'พัฒนาร้านกับผู้เชี่ยวชาญตัวจริง',
    linesEn: [
      'An expert matched to your stall',
      'Diagnosis based on your KhaiDee data',
      'A plan written for your stall',
      'Monthly consultation and follow-up',
    ],
    linesTh: [
      'จับคู่ผู้เชี่ยวชาญให้ตรงกับร้านคุณ',
      'วิเคราะห์จากข้อมูล KhaiDee ของคุณ',
      'แผนพัฒนาที่เขียนให้ร้านคุณโดยเฉพาะ',
      'ปรึกษาและติดตามผลรายเดือน',
    ],
    inherits: 'pro',
  },
};

const rank = (tier: Tier): number => TIER_ORDER.indexOf(tier);

/** Tiers are cumulative: Pro includes everything Free has. */
export function can(tier: Tier, feature: Feature): boolean {
  return rank(tier) >= rank(FEATURES[feature]);
}

export function requiredTier(feature: Feature): Tier {
  return FEATURES[feature];
}

/** Every feature a tier unlocks, for the client to gate its own UI with. */
export function entitlements(tier: Tier): Feature[] {
  return (Object.keys(FEATURES) as Feature[]).filter((feature) =>
    can(tier, feature),
  );
}

/** The next tier up, or null at the top. */
export function nextTier(tier: Tier): Tier | null {
  return TIER_ORDER[rank(tier) + 1] ?? null;
}

export function isTier(value: unknown): value is Tier {
  return typeof value === 'string' && TIER_ORDER.includes(value as Tier);
}

/**
 * What a stall pays to reach a feature it does not have. Null when it already
 * does — a caller that gets null should not be showing an upgrade prompt.
 */
export function upgradeFor(
  tier: Tier,
  feature: Feature,
): { tier: Tier; price: number } | null {
  if (can(tier, feature)) return null;
  const target = requiredTier(feature);
  return { tier: target, price: PLANS[target].price };
}

/** "฿299 / month", or "Free" — the price as the plans screen says it. */
export function priceLabel(tier: Tier, language: 'th' | 'en' = 'en'): string {
  const plan = PLANS[tier];
  if (plan.price === 0) return language === 'th' ? 'ฟรี' : 'Free';
  const amount = plan.price.toLocaleString('en-US');
  return language === 'th' ? `฿${amount} / เดือน` : `฿${amount} / month`;
}
