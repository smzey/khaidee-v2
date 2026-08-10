import { ApiError } from './api';
import { restoreRememberedSessionWith } from './authFlow';
import type { Session, Stall } from './session';

const cachedStall: Stall = {
  id: 'v1',
  slug: 'somchai',
  name: 'Old Stall Name',
  promptpayId: null,
  isOpen: false,
  tier: 'free',
};

const freshStall: Stall = {
  ...cachedStall,
  name: 'Fresh Stall Name',
  promptpayId: '0812345678',
  isOpen: true,
  tier: 'premium',
};

const cachedSession: Session = {
  token: 'remembered-token',
  stall: cachedStall,
};

describe('restoreRememberedSessionWith', () => {
  it('refreshes remembered stall data before opening the app', async () => {
    const saved: Session[] = [];

    const session = await restoreRememberedSessionWith({
      load: async () => cachedSession,
      validate: async () => ({ vendor: freshStall }),
      save: async (next) => {
        saved.push(next);
      },
      clear: async () => {
        throw new Error('clear should not run');
      },
    });

    expect(session).toEqual({ token: cachedSession.token, stall: freshStall });
    expect(saved).toEqual([{ token: cachedSession.token, stall: freshStall }]);
  });

  it('clears a remembered token that the API rejects', async () => {
    let cleared = false;

    const session = await restoreRememberedSessionWith({
      load: async () => cachedSession,
      validate: async () => {
        throw new ApiError(401, 'unauthorized', 'Sign in');
      },
      save: async () => {
        throw new Error('save should not run');
      },
      clear: async () => {
        cleared = true;
      },
    });

    expect(session).toBeNull();
    expect(cleared).toBe(true);
  });

  it('keeps the cached session when validation fails offline', async () => {
    let cleared = false;

    const session = await restoreRememberedSessionWith({
      load: async () => cachedSession,
      validate: async () => {
        throw new ApiError(0, 'offline', 'No connection');
      },
      save: async () => {
        throw new Error('save should not run');
      },
      clear: async () => {
        cleared = true;
      },
    });

    expect(session).toEqual(cachedSession);
    expect(cleared).toBe(false);
  });
});
