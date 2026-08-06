import {
  type Feature,
  PLANS,
  type Tier,
  can,
  entitlements,
  requiredTier,
} from '@khaidee/domain';
import { HttpError } from './errors.js';

/**
 * The gate.
 *
 * Enforced here rather than in the app, because a gate the client owns is a
 * suggestion. The app hides what a stall has not paid for so it never walks
 * into a wall; this is what makes that true.
 */

/**
 * 402 rather than 403. The request was legitimate and the stall is who they
 * say they are — the only thing missing is a payment, and the client should
 * show a price rather than an error.
 */
export function requireFeature(tier: Tier, feature: Feature): void {
  if (can(tier, feature)) return;

  const needed = requiredTier(feature);
  const plan = PLANS[needed];

  throw new HttpError(
    402,
    'upgrade_required',
    `${plan.nameEn} unlocks this — ${plan.taglineEn.toLowerCase()}.`,
    {
      feature,
      currentTier: tier,
      requiredTier: needed,
      price: plan.price,
    },
  );
}

/** What the clients are told at sign-in, so they can gate their own screens. */
export function tierSummary(tier: Tier) {
  return {
    tier,
    price: PLANS[tier].price,
    features: entitlements(tier),
  };
}
