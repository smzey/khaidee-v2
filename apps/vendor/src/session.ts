import { type Tier, isTier } from '@khaidee/domain';
import { storage } from './storage';

const TOKEN_KEY = 'khaidee.vendor.token';
const STALL_KEY = 'khaidee.vendor.stall';

export interface Stall {
  id: string;
  slug: string;
  name: string;
  promptpayId: string | null;
  isOpen: boolean;
  /** What the stall pays for. Absent on a session saved before tiers existed. */
  tier: Tier;
}

export interface Session {
  token: string;
  stall: Stall;
}

/**
 * The token is HMAC-signed and lasts a month, so a stall phone that has been
 * off overnight — or off the network for a week — comes back signed in. The
 * vendor should be typing a PIN roughly never.
 */
export async function loadSession(): Promise<Session | null> {
  try {
    const [token, stallJson] = await Promise.all([
      storage.getItem(TOKEN_KEY),
      storage.getItem(STALL_KEY),
    ]);
    if (!token || !stallJson) return null;
    const stall = JSON.parse(stallJson) as Partial<Stall>;
    if (!stall.id || !stall.slug || !stall.name || typeof stall.isOpen !== 'boolean') {
      return null;
    }
    return {
      token,
      stall: {
        id: stall.id,
        slug: stall.slug,
        name: stall.name,
        promptpayId: stall.promptpayId ?? null,
        isOpen: stall.isOpen,
        // A session stored before tiers shipped has none. Free is the safe
        // reading: the app shows an upsell, and the server is the real gate.
        tier: isTier(stall.tier) ? stall.tier : 'free',
      },
    };
  } catch {
    return null;
  }
}

export async function saveSession(session: Session): Promise<void> {
  await storage.setItem(TOKEN_KEY, session.token);
  await storage.setItem(STALL_KEY, JSON.stringify(session.stall));
}

export async function clearSession(): Promise<void> {
  await storage.multiRemove([TOKEN_KEY, STALL_KEY]);
}

export async function saveStallIfRemembered(stall: Stall): Promise<void> {
  const token = await storage.getItem(TOKEN_KEY);
  if (!token) return;
  await storage.setItem(STALL_KEY, JSON.stringify(stall));
}

const LAST_EVENT_KEY = 'khaidee.vendor.lastEventId';

/**
 * The id of the last event this phone actually saw. Kept across launches so
 * a vendor who closes the app, or whose phone dies, replays what arrived
 * while it was gone rather than starting blind from now.
 */
export async function loadLastEventId(): Promise<number> {
  try {
    const raw = await storage.getItem(LAST_EVENT_KEY);
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

export async function saveLastEventId(id: number): Promise<void> {
  if (id <= 0) return;
  try {
    await storage.setItem(LAST_EVENT_KEY, String(id));
  } catch {
    /* losing this costs a replay, not an order */
  }
}
