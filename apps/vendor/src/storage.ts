import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Key-value storage, three operations wide.
 *
 * There is a `.web.ts` beside this file that Metro picks for web builds.
 * AsyncStorage's own web shim calls `mergeOptions.default.bind(...)`, and
 * `merge-options` exposes no `.default` under Metro's interop, so importing it
 * on web crashes the bundle at load. On iOS and Android the native module is
 * used and that path is never reached, so this file stays as it is.
 */
export const storage = {
  async getItem(key: string): Promise<string | null> {
    return AsyncStorage.getItem(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    await AsyncStorage.setItem(key, value);
  },
  async multiRemove(keys: string[]): Promise<void> {
    await AsyncStorage.multiRemove(keys);
  },
};
