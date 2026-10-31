/**
 * Every interactive element must carry a stable testID, because UI tests (Detox,
 * Maestro, Appium) select by it. This renders every screen state and checks the
 * host tree: anything pressable or editable without a testID fails, and so does a
 * testID used twice on one screen.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';
import { createApiClient, type User } from '../src/api/client';
import {
  ConfigErrorScreen,
  StartupScreen,
  UpdateRequiredScreen,
} from '../src/screens/GateScreens';
import { KycScreen } from '../src/screens/KycScreen';
import { LoginScreen } from '../src/screens/LoginScreen';
import { WalletScreen } from '../src/screens/WalletScreen';
import { TestIDs } from '../src/testIDs';
import { createFakeBackend } from './fakeBackend';

function interactiveWithoutTestID(root: TestInstance): string[] {
  const missing: string[] = [];
  const ids = new Map<string, number>();
  const visit = (node: TestInstance) => {
    const p = node.props;
    if (typeof p.testID === 'string')
      ids.set(p.testID, (ids.get(p.testID) ?? 0) + 1);
    const interactive =
      node.type === 'TextInput' ||
      typeof p.onPress === 'function' ||
      typeof p.onClick === 'function' ||
      typeof p.onResponderRelease === 'function' ||
      ['button', 'radio', 'switch', 'checkbox', 'link'].includes(
        p.accessibilityRole ?? p.role,
      );
    if (interactive && typeof p.testID !== 'string') {
      missing.push(`${node.type} ${p.accessibilityLabel ?? ''}`.trim());
    }
    node.children.forEach(child => {
      if (typeof child !== 'string') visit(child);
    });
  };
  visit(root);
  for (const [id, count] of ids)
    if (count > 1) missing.push(`duplicate testID ${id}`);
  return missing;
}

const user: User = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'asha@example.com',
  fullName: 'Asha Rao',
  role: 'USER',
  kycStatus: 'APPROVED',
  createdAt: '2026-10-31T00:00:00Z',
};

async function signedInApi() {
  const backend = createFakeBackend();
  backend.users.set(user.email, {
    password: 'pw',
    user: { ...user, kycStatus: 'NOT_STARTED' },
  });
  const login = await backend.fetch(
    new Request('http://x/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'pw' }),
    }),
  );
  const { accessToken } = (await login.json()) as { accessToken: string };
  backend.topUps.push({
    id: 't1',
    amountMinor: 100,
    currency: 'INR',
    status: 'SUCCEEDED',
    createdAt: '2026-10-31T00:00:00Z',
  });
  return createApiClient({
    baseUrl: 'http://x',
    getToken: () => accessToken,
    onUnauthorized: () => {},
    fetchImpl: backend.fetch,
  });
}

const noop = () => {};

describe('every interactive element has a unique testID', () => {
  const cases: [string, () => Promise<React.ReactElement>, string][] = [
    [
      'startup (loading)',
      async () => <StartupScreen envName="dev" error={null} onRetry={noop} />,
      TestIDs.startup.loading,
    ],
    [
      'startup (error)',
      async () => (
        <StartupScreen envName="dev" error="offline" onRetry={noop} />
      ),
      TestIDs.startup.retryButton,
    ],
    [
      'update required',
      async () => (
        <UpdateRequiredScreen
          envName="dev"
          installedVersion="1.0.0"
          minimumVersion="2.0.0"
          checking={false}
          onCheckAgain={noop}
        />
      ),
      TestIDs.updateRequired.retryButton,
    ],
    [
      'config error',
      async () => <ConfigErrorScreen message="x" />,
      TestIDs.configError.screen,
    ],
    [
      'login',
      async () => (
        <LoginScreen
          api={await signedInApi()}
          envName="dev"
          onSignedIn={async () => {}}
        />
      ),
      TestIDs.login.submitButton,
    ],
    [
      'kyc (form)',
      async () => (
        <KycScreen
          api={await signedInApi()}
          envName="dev"
          pickDocument={async () => ({ kind: 'cancelled' })}
          onApproved={noop}
          onSignOut={noop}
        />
      ),
      TestIDs.kyc.submitButton,
    ],
    [
      'wallet (dev, test cards)',
      async () => (
        <WalletScreen
          api={await signedInApi()}
          envName="dev"
          user={user}
          onSignOut={noop}
        />
      ),
      TestIDs.wallet.topUpItem('t1'),
    ],
    [
      'wallet (prod)',
      async () => (
        <WalletScreen
          api={await signedInApi()}
          envName="prod"
          user={user}
          onSignOut={noop}
        />
      ),
      TestIDs.wallet.topUpItem('t1'),
    ],
  ];

  it.each(cases)('%s', async (_name, element, readyTestID) => {
    await render(await element());
    await screen.findByTestId(readyTestID);
    expect(interactiveWithoutTestID(screen.root!)).toEqual([]);
  });

  it('login in register mode', async () => {
    await render(
      <LoginScreen
        api={await signedInApi()}
        envName="dev"
        onSignedIn={async () => {}}
      />,
    );
    const { fireEvent } = require('@testing-library/react-native');
    await fireEvent.press(screen.getByTestId(TestIDs.login.modeRegister));
    await screen.findByTestId(TestIDs.login.fullNameInput);
    expect(interactiveWithoutTestID(screen.root!)).toEqual([]);
  });

  it('production has no test cards and no environment badge', async () => {
    await render(
      <WalletScreen
        api={await signedInApi()}
        envName="prod"
        user={user}
        onSignOut={noop}
      />,
    );
    await screen.findByTestId(TestIDs.wallet.balance);
    expect(screen.queryByTestId(TestIDs.wallet.testCard('approve'))).toBeNull();
    expect(screen.queryByTestId(TestIDs.wallet.topUpButton)).toBeNull();
    expect(screen.queryByTestId(TestIDs.envBadge)).toBeNull();
  });
});

describe('no AsyncStorage anywhere', () => {
  it('is not a dependency and nothing in src imports it', () => {
    const fs = require('fs');
    const path = require('path');
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'),
    );
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d: string) => /async-storage/i.test(d))).toEqual([]);

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (
          /\.(ts|tsx|js)$/.test(entry.name) &&
          /(from\s+|require\()\s*['"][^'"]*async-storage/.test(
            fs.readFileSync(full, 'utf8'),
          )
        ) {
          offenders.push(full);
        }
      }
    };
    walk(path.join(__dirname, '..', 'src'));
    expect(offenders).toEqual([]);
  });
});
