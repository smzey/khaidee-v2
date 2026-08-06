import { describe, expect, it } from 'vitest';
import {
  FEATURES,
  type Feature,
  PLANS,
  TIER_ORDER,
  type Tier,
  can,
  entitlements,
  isTier,
  nextTier,
  priceLabel,
  requiredTier,
  upgradeFor,
} from './tiers.js';

const everyFeature = Object.keys(FEATURES) as Feature[];

describe('what each tier can do', () => {
  it('gives a free stall the things that make the app worth opening', () => {
    expect(can('free', 'sales_recording')).toBe(true);
    expect(can('free', 'basic_dashboard')).toBe(true);
    expect(can('free', 'low_stock_alerts')).toBe(true);
  });

  it("gives away today's report, because it is the argument for paying", () => {
    expect(can('free', 'ai_report_today')).toBe(true);
  });

  it('includes the current core modules in Free', () => {
    expect(can('free', 'ai_report_range')).toBe(true);
    expect(can('free', 'weather_insights')).toBe(true);
    expect(can('free', 'next_day_prep')).toBe(true);
    expect(can('free', 'assistant')).toBe(true);
  });

  it('keeps growth services for Pro', () => {
    expect(can('free', 'annual_health_check')).toBe(false);
    expect(can('pro', 'annual_health_check')).toBe(true);
  });

  it('keeps a human expert for Premium', () => {
    expect(can('pro', 'expert_matching')).toBe(false);
    expect(can('premium', 'expert_matching')).toBe(true);
  });
});

describe('tiers are cumulative', () => {
  it('never takes away something a cheaper tier had', () => {
    for (const feature of everyFeature) {
      for (let i = 1; i < TIER_ORDER.length; i += 1) {
        const cheaper = TIER_ORDER[i - 1] as Tier;
        const dearer = TIER_ORDER[i] as Tier;
        if (can(cheaper, feature)) {
          expect(can(dearer, feature), `${dearer} lost ${feature}`).toBe(true);
        }
      }
    }
  });

  it('gives the top tier everything', () => {
    expect(entitlements('premium')).toHaveLength(everyFeature.length);
  });
});

describe('entitlements', () => {
  it('lists what a tier unlocks', () => {
    expect(entitlements('free')).toContain('sales_recording');
    expect(entitlements('free')).toContain('assistant');
    expect(entitlements('free')).not.toContain('expert_matching');
  });

  it('grows as the tier does', () => {
    expect(entitlements('pro').length).toBeGreaterThan(entitlements('free').length);
  });
});

describe('upgradeFor', () => {
  it('names the tier and the price that unlock a feature', () => {
    expect(upgradeFor('free', 'annual_health_check')).toEqual({
      tier: 'pro',
      price: 299,
    });
  });

  it('points at Premium for an expert', () => {
    expect(upgradeFor('pro', 'expert_matching')).toEqual({
      tier: 'premium',
      price: 1700,
    });
  });

  it('says nothing when the stall already has it', () => {
    expect(upgradeFor('pro', 'assistant')).toBeNull();
    expect(upgradeFor('free', 'sales_recording')).toBeNull();
  });
});

describe('nextTier', () => {
  it('walks up the ladder', () => {
    expect(nextTier('free')).toBe('pro');
    expect(nextTier('pro')).toBe('premium');
  });

  it('stops at the top', () => {
    expect(nextTier('premium')).toBeNull();
  });
});

describe('requiredTier', () => {
  it('reports the cheapest tier that includes a feature', () => {
    expect(requiredTier('ai_report_today')).toBe('free');
    expect(requiredTier('next_day_prep')).toBe('free');
    expect(requiredTier('expert_matching')).toBe('premium');
  });
});

describe('isTier', () => {
  it('accepts the three we sell', () => {
    expect(isTier('free')).toBe(true);
    expect(isTier('premium')).toBe(true);
  });

  it('rejects anything else, including a plausible one', () => {
    expect(isTier('enterprise')).toBe(false);
    expect(isTier('')).toBe(false);
    expect(isTier(null)).toBe(false);
    expect(isTier(2)).toBe(false);
  });
});

describe('priceLabel', () => {
  it('says Free rather than ฿0', () => {
    expect(priceLabel('free')).toBe('Free');
    expect(priceLabel('free', 'th')).toBe('ฟรี');
  });

  it('groups thousands', () => {
    expect(priceLabel('premium')).toBe('฿1,700 / month');
  });

  it('speaks Thai when asked', () => {
    expect(priceLabel('pro', 'th')).toBe('฿299 / เดือน');
  });
});

describe('the plans, as the screen renders them', () => {
  it('has a plan for every tier', () => {
    for (const tier of TIER_ORDER) {
      expect(PLANS[tier].tier).toBe(tier);
    }
  });

  it('prices them in the order they are sold', () => {
    expect(PLANS.free.price).toBeLessThan(PLANS.pro.price);
    expect(PLANS.pro.price).toBeLessThan(PLANS.premium.price);
  });

  it('translates every line, so no plan is half Thai', () => {
    for (const tier of TIER_ORDER) {
      const plan = PLANS[tier];
      expect(plan.linesTh).toHaveLength(plan.linesEn.length);
      expect(plan.nameTh.length).toBeGreaterThan(0);
      expect(plan.taglineTh.length).toBeGreaterThan(0);
    }
  });

  it('says what each paid plan builds on', () => {
    expect(PLANS.free.inherits).toBeNull();
    expect(PLANS.pro.inherits).toBe('free');
    expect(PLANS.premium.inherits).toBe('pro');
  });
});
