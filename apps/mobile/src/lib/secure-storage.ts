/**
 * The auth session's storage: the hardware-backed keystore, not a plain file.
 *
 * supabase-js persists the access AND refresh tokens through this. The refresh
 * token is long-lived and buys ongoing access to someone's bank data, so it
 * belongs in expo-secure-store (Android Keystore / iOS Keychain) rather than in
 * AsyncStorage, which is an unencrypted SQLite file in the app's sandbox.
 *
 * Android's keystore refuses values over roughly 2 KB and a Supabase session is
 * bigger, so a value is split across numbered keys with a manifest at the
 * original key. The backend is injected so the chunking is testable with
 * `npm test`; supabase.ts passes the real expo-secure-store.
 */

/** Small enough to clear Android's ~2 KB ceiling with room for the key itself. */
export const CHUNK_SIZE = 1800;

/** What supabase-js wants. Also the shape of the legacy AsyncStorage we migrate from. */
export type KeyValueStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

/**
 * The slice of expo-secure-store this uses. `O` is its options object (for
 * example `{ keychainAccessible }`), kept generic so this file imports nothing native.
 */
export type SecureBackend<O = unknown> = {
  getItemAsync(key: string, options?: O): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: O): Promise<void>;
  deleteItemAsync(key: string, options?: O): Promise<void>;
};

const chunkKey = (key: string, i: number) => `${key}.${i}`;

const split = (value: string): string[] => {
  const parts: string[] = [];
  for (let i = 0; i < value.length; i += CHUNK_SIZE) parts.push(value.slice(i, i + CHUNK_SIZE));
  // An empty string is one empty chunk, not zero: zero would read back as absent.
  return parts.length > 0 ? parts : [''];
};

/**
 * @param secure the keystore.
 * @param legacy the AsyncStorage sessions were kept in before; when given, a
 *   value found there is moved across on first read and deleted from it.
 * @param options passed on every keystore call, chunks and deletes included. On
 *   iOS `keychainAccessible` is applied when an item is written, so each write
 *   (the next token refresh) moves an existing session to the new class.
 */
export function createSecureStorage<O>(secure: SecureBackend<O>, legacy?: KeyValueStore, options?: O): KeyValueStore {
  /** How many chunks `key` currently holds, or null when it holds nothing. */
  const readCount = async (key: string): Promise<number | null> => {
    const manifest = await secure.getItemAsync(key, options);
    if (manifest === null) return null;
    const count = Number(manifest);
    return Number.isInteger(count) && count > 0 ? count : null;
  };

  /** Drop the manifest and every chunk. Safe to call on a key that holds nothing. */
  const clear = async (key: string, knownCount?: number | null) => {
    const count = knownCount === undefined ? await readCount(key) : knownCount;
    // The manifest goes first: a read racing this fails closed rather than
    // reassembling a half-deleted session.
    await secure.deleteItemAsync(key, options);
    for (let i = 0; i < (count ?? 0); i++) await secure.deleteItemAsync(chunkKey(key, i), options);
  };

  const write = async (key: string, value: string) => {
    const stale = await readCount(key);
    await clear(key, stale);
    const parts = split(value);
    for (const [i, part] of parts.entries()) await secure.setItemAsync(chunkKey(key, i), part, options);
    // Manifest last, so the key only reads as present once every chunk is there.
    await secure.setItemAsync(key, String(parts.length), options);
  };

  return {
    async getItem(key) {
      try {
        const count = await readCount(key);
        if (count === null) {
          if (!legacy) return null;
          // One-time migration off AsyncStorage. A failure here just means the
          // user signs in again, so it must never throw.
          const inherited = await legacy.getItem(key);
          if (inherited === null) return null;
          await write(key, inherited);
          await legacy.removeItem(key);
          return inherited;
        }
        let value = '';
        for (let i = 0; i < count; i++) {
          const part = await secure.getItemAsync(chunkKey(key, i), options);
          // A missing chunk means an interrupted write: report nothing rather
          // than a truncated token that would fail in confusing ways later.
          if (part === null) return null;
          value += part;
        }
        return value;
      } catch {
        return null;
      }
    },

    async setItem(key, value) {
      try {
        await write(key, value);
      } catch {
        // Nothing useful to do: the session stays in memory for this launch.
      }
    },

    async removeItem(key) {
      try {
        await clear(key);
      } catch {
        // Same: a failed sign-out wipe must not throw into supabase-js.
      }
    },
  };
}
