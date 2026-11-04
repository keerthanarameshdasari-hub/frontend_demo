import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import App, { type AppDeps } from '../src/App';
import type { StoredSession, TokenStore } from '../src/auth/tokenStore';
import type { AppConfig } from '../src/config';
import { TestIDs } from '../src/testIDs';
import { createFakeBackend, type FakeBackend } from './fakeBackend';

const DEV: AppConfig = { envName: 'dev', apiUrl: 'http://10.0.2.2:3000' };

function memoryTokenStore(
  initial: StoredSession | null = null,
): TokenStore & { current: () => StoredSession | null } {
  let stored = initial;
  return {
    current: () => stored,
    save: async session => {
      stored = session;
    },
    load: async () => stored,
    clear: async () => {
      stored = null;
    },
  };
}

function setup(
  options: {
    backend?: FakeBackend;
    installedVersion?: string;
    config?: AppConfig;
    tokenStore?: ReturnType<typeof memoryTokenStore>;
    pickDocument?: AppDeps['pickDocument'];
  } = {},
) {
  const backend = options.backend ?? createFakeBackend();
  const tokenStore = options.tokenStore ?? memoryTokenStore();
  const deps: Partial<AppDeps> = {
    readConfig: () => options.config ?? DEV,
    installedVersion: () => options.installedVersion ?? '1.0.0',
    tokenStore,
    fetchImpl: backend.fetch,
    pickDocument:
      options.pickDocument ??
      (async () => ({
        kind: 'picked',
        file: {
          uri: 'file:///passport.png',
          name: 'passport.png',
          type: 'image/png',
        },
      })),
    now: () => Date.UTC(2026, 9, 31),
  };
  return { backend, tokenStore, deps };
}

async function type(testID: string, text: string) {
  await fireEvent.changeText(screen.getByTestId(testID), text);
}
async function press(testID: string) {
  await fireEvent.press(screen.getByTestId(testID));
}

async function registerAndSignIn(email = 'asha@example.com') {
  await screen.findByTestId(TestIDs.login.screen);
  await press(TestIDs.login.modeRegister);
  await type(TestIDs.login.fullNameInput, 'Asha Rao');
  await type(TestIDs.login.emailInput, email);
  await type(TestIDs.login.passwordInput, 'correct-horse-battery');
  await press(TestIDs.login.submitButton);
}

async function passKyc(documentNumber = 'P1234567') {
  await screen.findByTestId(TestIDs.kyc.submitButton);
  await press(TestIDs.kyc.documentType('PASSPORT'));
  await type(TestIDs.kyc.documentNumberInput, documentNumber);
  await press(TestIDs.kyc.pickFileButton);
  await screen.findByTestId(TestIDs.kyc.pickedFileName);
  await press(TestIDs.kyc.submitButton);
}

describe('launch: minimum app version', () => {
  it('blocks an outdated build with "Update required" and nothing else', async () => {
    const { deps, backend } = setup({
      installedVersion: '1.0.0',
      backend: createFakeBackend({ minAppVersion: '1.2.0' }),
    });
    await render(<App deps={deps} />);

    await screen.findByTestId(TestIDs.updateRequired.screen);
    expect(
      screen.getByTestId(TestIDs.updateRequired.installedVersion),
    ).toHaveTextContent(/1\.0\.0/);
    expect(
      screen.getByTestId(TestIDs.updateRequired.minimumVersion),
    ).toHaveTextContent(/1\.2\.0/);
    expect(screen.queryByTestId(TestIDs.login.screen)).toBeNull();
    // It checked the version first and asked for nothing else.
    expect(backend.requests.map(r => r.path)).toEqual([
      '/meta/min-app-version',
    ]);
  });

  it('stays blocked on "Check again" until the server minimum allows this build', async () => {
    const { deps, backend } = setup({
      backend: createFakeBackend({ minAppVersion: '2.0.0' }),
    });
    await render(<App deps={deps} />);
    await screen.findByTestId(TestIDs.updateRequired.screen);

    await press(TestIDs.updateRequired.retryButton);
    await screen.findByTestId(TestIDs.updateRequired.screen);

    backend.minAppVersion = '1.0.0';
    await press(TestIDs.updateRequired.retryButton);
    await screen.findByTestId(TestIDs.login.screen);
  });

  it('lets a current build through to sign-in', async () => {
    const { deps } = setup({
      installedVersion: '1.0.0',
      backend: createFakeBackend({ minAppVersion: '1.0.0' }),
    });
    await render(<App deps={deps} />);
    await screen.findByTestId(TestIDs.login.screen);
    expect(screen.getByTestId(TestIDs.envBadge)).toHaveTextContent('DEV');
  });

  it('shows a retryable error when the backend is unreachable', async () => {
    const { deps, backend } = setup();
    backend.failNextRequestTo('/meta/min-app-version');
    await render(<App deps={deps} />);

    await screen.findByTestId(TestIDs.startup.error);
    expect(screen.getByTestId(TestIDs.startup.errorMessage)).toHaveTextContent(
      /Couldn't reach the server/,
    );
    await press(TestIDs.startup.retryButton);
    await screen.findByTestId(TestIDs.login.screen);
  });

  it('refuses to start a build without env config', async () => {
    const { deps } = setup();
    await render(
      <App
        deps={{
          ...deps,
          readConfig: () => {
            throw new (require('../src/config').ConfigError)('ENV_NAME is ""');
          },
        }}
      />,
    );
    expect(screen.getByTestId(TestIDs.configError.screen)).toBeOnTheScreen();
  });
});

describe('sign in, KYC, wallet', () => {
  it('registers, passes KYC and tops up, storing the token only in the token store', async () => {
    const { deps, backend, tokenStore } = setup();
    await render(<App deps={deps} />);

    await registerAndSignIn();
    await screen.findByTestId(TestIDs.kyc.screen);
    expect(tokenStore.current()?.accessToken).toMatch(/^token-/);
    expect(tokenStore.current()?.expiresAt).toBe(
      Date.UTC(2026, 9, 31) + 3600 * 1000,
    );

    await passKyc();
    await waitFor(() =>
      expect(screen.getByTestId(TestIDs.kyc.status)).toHaveTextContent(
        /Verified/,
      ),
    );
    const upload = backend.requests.find(
      r => r.method === 'POST' && r.path === '/kyc',
    )!;
    expect(upload.body).toMatchObject({
      documentType: 'PASSPORT',
      documentNumber: 'P1234567',
    });
    expect(upload.headers.get('content-type')).toMatch(
      /^multipart\/form-data; boundary=/,
    );
    expect(upload.headers.get('authorization')).toMatch(/^Bearer token-/);

    await press(TestIDs.kyc.continueButton);
    await screen.findByTestId(TestIDs.wallet.screen);
    await waitFor(() =>
      expect(screen.getByTestId(TestIDs.wallet.balance)).toHaveTextContent(
        '₹0.00',
      ),
    );

    await type(TestIDs.wallet.amountInput, '500');
    await press(TestIDs.wallet.testCard('approve'));
    await press(TestIDs.wallet.topUpButton);
    await waitFor(() =>
      expect(screen.getByTestId(TestIDs.wallet.balance)).toHaveTextContent(
        '₹500.00',
      ),
    );
    expect(screen.getByTestId(TestIDs.wallet.topUpResult)).toHaveTextContent(
      '₹500.00 added to your wallet.',
    );

    const topUp = backend.requests.find(
      r => r.method === 'POST' && r.path === '/wallet/top-ups',
    )!;
    expect(topUp.body).toEqual({
      amountMinor: 50000,
      paymentToken: 'tok_visa',
    });
    expect(topUp.headers.get('idempotency-key')).toMatch(/^topup-/);
  });

  it('reports a declined card without changing the balance', async () => {
    const { deps } = setup();
    await render(<App deps={deps} />);
    await registerAndSignIn();
    await passKyc();
    await screen.findByTestId(TestIDs.kyc.continueButton);
    await press(TestIDs.kyc.continueButton);
    await screen.findByTestId(TestIDs.wallet.balance);

    await type(TestIDs.wallet.amountInput, '250');
    await press(TestIDs.wallet.testCard('decline'));
    await press(TestIDs.wallet.topUpButton);
    await waitFor(() =>
      expect(screen.getByTestId(TestIDs.wallet.topUpResult)).toHaveTextContent(
        /declined/,
      ),
    );
    expect(screen.getByTestId(TestIDs.wallet.balance)).toHaveTextContent(
      '₹0.00',
    );
  });

  it('retries a top-up lost to a network error with the same Idempotency-Key, so it charges once', async () => {
    const { deps, backend } = setup();
    await render(<App deps={deps} />);
    await registerAndSignIn();
    await passKyc();
    await screen.findByTestId(TestIDs.kyc.continueButton);
    await press(TestIDs.kyc.continueButton);
    await screen.findByTestId(TestIDs.wallet.balance);

    await type(TestIDs.wallet.amountInput, '100');
    backend.failNextRequestTo('/wallet/top-ups');
    await press(TestIDs.wallet.topUpButton);
    await waitFor(() =>
      expect(screen.getByTestId(TestIDs.wallet.error)).toHaveTextContent(
        /won't charge you twice/,
      ),
    );

    await press(TestIDs.wallet.topUpButton);
    await waitFor(() =>
      expect(screen.getByTestId(TestIDs.wallet.balance)).toHaveTextContent(
        '₹100.00',
      ),
    );

    const keys = backend.requests
      .filter(r => r.method === 'POST' && r.path === '/wallet/top-ups')
      .map(r => r.headers.get('idempotency-key'));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(backend.topUps).toHaveLength(1);
  });

  it('keeps a rejected KYC on the KYC screen so the user can resubmit', async () => {
    const { deps } = setup();
    await render(<App deps={deps} />);
    await registerAndSignIn();
    await passKyc('REJECT-1234');
    await waitFor(() =>
      expect(screen.getByTestId(TestIDs.kyc.status)).toHaveTextContent(
        /not accepted/,
      ),
    );
    expect(screen.getByTestId(TestIDs.kyc.submitButton)).toBeOnTheScreen();
    expect(screen.queryByTestId(TestIDs.kyc.continueButton)).toBeNull();
  });

  it('shows a wrong password without signing in', async () => {
    const { deps, backend, tokenStore } = setup();
    backend.users.set('asha@example.com', {
      password: 'correct-horse-battery',
      user: {
        id: '1',
        email: 'asha@example.com',
        fullName: 'Asha',
        role: 'USER',
        kycStatus: 'APPROVED',
        createdAt: '2026-10-31T00:00:00Z',
      },
    });
    await render(<App deps={deps} />);
    await screen.findByTestId(TestIDs.login.screen);
    await type(TestIDs.login.emailInput, 'asha@example.com');
    await type(TestIDs.login.passwordInput, 'wrong-password');
    await press(TestIDs.login.submitButton);
    await waitFor(() =>
      expect(screen.getByTestId(TestIDs.login.error)).toHaveTextContent(
        'Email or password is incorrect.',
      ),
    );
    expect(tokenStore.current()).toBeNull();
  });
});

describe('session', () => {
  it('restores a stored session on launch and goes straight to the wallet when KYC is approved', async () => {
    const backend = createFakeBackend();
    // Sign in once to get a token the fake backend knows.
    const first = setup({ backend });
    const view = await render(<App deps={first.deps} />);
    await registerAndSignIn();
    await passKyc();
    await screen.findByTestId(TestIDs.kyc.continueButton);
    await view.unmount();

    const second = setup({
      backend,
      tokenStore: memoryTokenStore(first.tokenStore.current()),
    });
    await render(<App deps={second.deps} />);
    await screen.findByTestId(TestIDs.wallet.screen);
  });

  it('signs out on 401 and says why', async () => {
    const { deps, backend, tokenStore } = setup();
    await render(<App deps={deps} />);
    await registerAndSignIn();
    await screen.findByTestId(TestIDs.kyc.screen);

    backend.expireAllTokens();
    await type(TestIDs.kyc.documentNumberInput, 'P1234567');
    await press(TestIDs.kyc.pickFileButton);
    await screen.findByTestId(TestIDs.kyc.pickedFileName);
    await press(TestIDs.kyc.submitButton);

    await screen.findByTestId(TestIDs.login.screen);
    expect(screen.getByText(/session has expired/)).toBeOnTheScreen();
    await waitFor(() => expect(tokenStore.current()).toBeNull());
  });

  it('sign out clears the stored token', async () => {
    const { deps, tokenStore } = setup();
    await render(<App deps={deps} />);
    await registerAndSignIn();
    await screen.findByTestId(TestIDs.kyc.signOutButton);
    await press(TestIDs.kyc.signOutButton);
    await screen.findByTestId(TestIDs.login.screen);
    expect(tokenStore.current()).toBeNull();
  });
});
