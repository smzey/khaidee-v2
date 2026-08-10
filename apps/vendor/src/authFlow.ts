import { fetchSession, isSignedOut, type VendorSessionResponse } from './api';
import {
  clearSession,
  loadSession,
  saveSession,
  type Session,
} from './session';

export async function restoreRememberedSessionWith(deps: {
  load: () => Promise<Session | null>;
  validate: (token: string) => Promise<VendorSessionResponse>;
  save: (session: Session) => Promise<void>;
  clear: () => Promise<void>;
}): Promise<Session | null> {
  const cached = await deps.load();
  if (!cached) return null;

  try {
    const refreshed = await deps.validate(cached.token);
    const session = { token: cached.token, stall: refreshed.vendor };
    await deps.save(session);
    return session;
  } catch (error) {
    if (isSignedOut(error)) {
      await deps.clear();
      return null;
    }
    return cached;
  }
}

export const restoreRememberedSession = () =>
  restoreRememberedSessionWith({
    load: loadSession,
    validate: fetchSession,
    save: saveSession,
    clear: clearSession,
  });
