/**
 * The access token lives in the platform keychain (iOS Keychain, Android Keystore-
 * encrypted storage) via react-native-keychain. Never AsyncStorage: that is a
 * plain, unencrypted file that backups and rooted devices can read.
 */
import * as Keychain from 'react-native-keychain';

export type StoredSession = {
  accessToken: string;
  /** Epoch milliseconds after which the token is no longer accepted. */
  expiresAt: number;
};

const SERVICE = 'com.demo.wallet.session';
const ACCOUNT = 'access-token';
/** Treat a token this close to expiry as already expired, so a request doesn't fail mid-flight. */
const EXPIRY_MARGIN_MS = 30_000;

export interface TokenStore {
  save(session: StoredSession): Promise<void>;
  /** The stored session, or null if there is none or it has expired (an expired one is deleted). */
  load(): Promise<StoredSession | null>;
  clear(): Promise<void>;
}

function isStoredSession(value: unknown): value is StoredSession {
  const v = value as Partial<StoredSession> | null;
  return (
    typeof v?.accessToken === 'string' &&
    v.accessToken.length > 0 &&
    typeof v.expiresAt === 'number'
  );
}

export function createKeychainTokenStore(
  keychain: Pick<
    typeof Keychain,
    'setGenericPassword' | 'getGenericPassword' | 'resetGenericPassword'
  > = Keychain,
  now: () => number = Date.now,
): TokenStore {
  const options = { service: SERVICE };

  async function clear(): Promise<void> {
    await keychain.resetGenericPassword(options);
  }

  return {
    async save(session) {
      const ok = await keychain.setGenericPassword(
        ACCOUNT,
        JSON.stringify(session),
        {
          ...options,
          // Readable only while the device is unlocked, and never restored to another device from a backup.
          accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        },
      );
      if (!ok) throw new Error('Could not save the session to the keychain');
    },

    async load() {
      let credentials: Awaited<ReturnType<typeof Keychain.getGenericPassword>>;
      try {
        credentials = await keychain.getGenericPassword(options);
      } catch {
        // An unreadable entry (e.g. keys invalidated by a device security change) means signed out.
        await clear().catch(() => undefined);
        return null;
      }
      if (!credentials) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(credentials.password);
      } catch {
        parsed = null;
      }
      if (
        !isStoredSession(parsed) ||
        parsed.expiresAt - EXPIRY_MARGIN_MS <= now()
      ) {
        await clear();
        return null;
      }
      return parsed;
    },

    clear,
  };
}
