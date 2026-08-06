/**
 * The web half of `storage.ts`. AsyncStorage's web implementation is a
 * localStorage wrapper with a broken ESM interop under Metro, so we use
 * localStorage directly and skip the dependency entirely.
 */
const memory = new Map<string, string>();

/** Falls back to memory when storage is blocked, as in private browsing. */
function backing(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.getItem('khaidee.probe');
      return localStorage;
    }
  } catch {
    /* fall through */
  }
  return {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
  };
}

export const storage = {
  async getItem(key: string): Promise<string | null> {
    return backing().getItem(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    backing().setItem(key, value);
  },
  async multiRemove(keys: string[]): Promise<void> {
    for (const key of keys) backing().removeItem(key);
  },
};
