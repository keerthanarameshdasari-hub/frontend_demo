/**
 * App root. On launch:
 *   1. read the build's env config (a broken build stops here);
 *   2. GET /meta/min-app-version; if this build is older, block on "Update required";
 *   3. restore the session from the keychain and load the user;
 *   4. route: not signed in → Login; KYC not approved → KYC; otherwise → Wallet.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { StatusBar } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  createApiClient,
  unwrap,
  type ApiClient,
  type Schemas,
  type User,
} from './api/client';
import { isUpdateRequired } from './appVersion';
import {
  createKeychainTokenStore,
  type StoredSession,
  type TokenStore,
} from './auth/tokenStore';
import { ConfigError, readConfig, type AppConfig } from './config';
import { describeError } from './errors';
import {
  ConfigErrorScreen,
  StartupScreen,
  UpdateRequiredScreen,
} from './screens/GateScreens';
import { KycScreen } from './screens/KycScreen';
import { LoginScreen } from './screens/LoginScreen';
import { WalletScreen } from './screens/WalletScreen';
import {
  pickDocument as defaultPickDocument,
  type PickDocument,
} from './screens/pickDocument';

export type AppDeps = {
  readConfig: () => AppConfig;
  /** The installed build's version (versionName / CFBundleShortVersionString). */
  installedVersion: () => string;
  tokenStore: TokenStore;
  pickDocument: PickDocument;
  fetchImpl?: typeof fetch;
  now: () => number;
};

const defaultDeps = (): AppDeps => ({
  readConfig,
  installedVersion: () => DeviceInfo.getVersion(),
  tokenStore: createKeychainTokenStore(),
  pickDocument: defaultPickDocument,
  now: Date.now,
});

type Phase =
  | { kind: 'starting'; error: string | null }
  | { kind: 'updateRequired'; installed: string; minimum: string }
  | { kind: 'signedOut'; notice: string | null }
  | { kind: 'signedIn'; user: User; screen: 'kyc' | 'wallet' };

const routeFor = (user: User) =>
  user.kycStatus === 'APPROVED' ? 'wallet' : 'kyc';

export default function App({
  deps: overrides,
}: { deps?: Partial<AppDeps> } = {}) {
  const deps = useMemo(() => ({ ...defaultDeps(), ...overrides }), [overrides]);

  const configResult = useMemo(():
    | { config: AppConfig }
    | { error: string } => {
    try {
      return { config: deps.readConfig() };
    } catch (e) {
      return { error: e instanceof ConfigError ? e.message : String(e) };
    }
  }, [deps]);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      {'error' in configResult ? (
        <ConfigErrorScreen message={configResult.error} />
      ) : (
        <ConfiguredApp config={configResult.config} deps={deps} />
      )}
    </SafeAreaProvider>
  );
}

function ConfiguredApp({ config, deps }: { config: AppConfig; deps: AppDeps }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'starting', error: null });
  const [rechecking, setRechecking] = useState(false);
  const session = useRef<StoredSession | null>(null);

  const signOut = useCallback(
    async (notice: string | null = null) => {
      session.current = null;
      setPhase({ kind: 'signedOut', notice });
      await deps.tokenStore.clear().catch(() => undefined);
    },
    [deps.tokenStore],
  );

  const api: ApiClient = useMemo(
    () =>
      createApiClient({
        baseUrl: config.apiUrl,
        getToken: () => session.current?.accessToken ?? null,
        onUnauthorized: () => {
          if (session.current)
            signOut('Your session has expired. Please sign in again.');
        },
        fetchImpl: deps.fetchImpl,
      }),
    [config.apiUrl, deps.fetchImpl, signOut],
  );

  /** Returns true when the app may continue (this build is new enough). */
  const checkVersion = useCallback(async (): Promise<boolean> => {
    const { minAppVersion } = unwrap(await api.GET('/meta/min-app-version'));
    const installed = deps.installedVersion();
    if (isUpdateRequired(installed, minAppVersion)) {
      setPhase({ kind: 'updateRequired', installed, minimum: minAppVersion });
      return false;
    }
    return true;
  }, [api, deps]);

  const start = useCallback(async () => {
    setPhase({ kind: 'starting', error: null });
    try {
      if (!(await checkVersion())) return;
      const stored = await deps.tokenStore.load();
      if (!stored) {
        setPhase({ kind: 'signedOut', notice: null });
        return;
      }
      session.current = stored;
      const result = await api.GET('/users/me');
      if (result.response.status === 401) return; // onUnauthorized already signed out
      const user = unwrap(result);
      setPhase({ kind: 'signedIn', user, screen: routeFor(user) });
    } catch (e) {
      setPhase({ kind: 'starting', error: describeError(e) });
    }
  }, [api, checkVersion, deps.tokenStore]);

  useEffect(() => {
    start();
  }, [start]);

  const onSignedIn = useCallback(
    async (token: Schemas['TokenResponse']) => {
      const stored: StoredSession = {
        accessToken: token.accessToken,
        expiresAt: deps.now() + token.expiresIn * 1000,
      };
      session.current = stored;
      try {
        const user = unwrap(await api.GET('/users/me'));
        await deps.tokenStore.save(stored);
        setPhase({ kind: 'signedIn', user, screen: routeFor(user) });
      } catch (e) {
        session.current = null; // stay signed out; LoginScreen shows the error
        throw e;
      }
    },
    [api, deps],
  );

  switch (phase.kind) {
    case 'starting':
      return (
        <StartupScreen
          envName={config.envName}
          error={phase.error}
          onRetry={start}
        />
      );
    case 'updateRequired':
      return (
        <UpdateRequiredScreen
          envName={config.envName}
          installedVersion={phase.installed}
          minimumVersion={phase.minimum}
          checking={rechecking}
          onCheckAgain={async () => {
            setRechecking(true);
            try {
              if (await checkVersion()) await start();
            } catch {
              // Still blocked; the screen stays as it is.
            } finally {
              setRechecking(false);
            }
          }}
        />
      );
    case 'signedOut':
      return (
        <LoginScreen
          api={api}
          envName={config.envName}
          notice={phase.notice}
          onSignedIn={onSignedIn}
        />
      );
    case 'signedIn':
      return phase.screen === 'kyc' ? (
        <KycScreen
          api={api}
          envName={config.envName}
          pickDocument={deps.pickDocument}
          onApproved={() =>
            setPhase({
              ...phase,
              user: { ...phase.user, kycStatus: 'APPROVED' },
              screen: 'wallet',
            })
          }
          onSignOut={() => signOut()}
        />
      ) : (
        <WalletScreen
          api={api}
          envName={config.envName}
          user={phase.user}
          onSignOut={() => signOut()}
        />
      );
  }
}
