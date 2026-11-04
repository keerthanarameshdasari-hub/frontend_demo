import {
  isUpdateRequired,
  parseVersion,
  compareVersions,
} from '../src/appVersion';
import { createKeychainTokenStore } from '../src/auth/tokenStore';
import { ConfigError, readConfig } from '../src/config';
import { formatMinor, parseMajorToMinor } from '../src/money';
import {
  newIdempotencyKey,
  testCardToken,
  testCardsAvailable,
} from '../src/payments';

describe('min-app-version gate', () => {
  it.each([
    ['1.0.0', '1.0.0', false],
    ['1.0.1', '1.0.0', false],
    ['2.0.0', '1.9.9', false],
    ['1.0.0', '1.0.1', true],
    ['1.9.0', '1.10.0', true], // numeric, not string, comparison
    ['0.9.9', '1.0.0', true],
    ['1.0.0-beta.1', '1.0.0', true], // a prerelease is older than its release
    ['1.0.0', '1.0.0-beta.1', false],
    ['1.0.0-beta.2', '1.0.0-beta.10', true],
  ])(
    'installed %s, minimum %s → update required: %s',
    (installed, minimum, expected) => {
      expect(isUpdateRequired(installed, minimum)).toBe(expected);
    },
  );

  it('fails closed when the installed version is unreadable', () => {
    expect(isUpdateRequired('1.0', '1.0.0')).toBe(true);
    expect(isUpdateRequired('', '1.0.0')).toBe(true);
  });

  it('does not lock everyone out when the server sends a malformed minimum', () => {
    expect(isUpdateRequired('1.0.0', 'latest')).toBe(false);
  });

  it('orders by semver precedence', () => {
    const v = (s: string) => parseVersion(s)!;
    expect(compareVersions(v('1.0.0-alpha'), v('1.0.0-alpha.1'))).toBeLessThan(
      0,
    );
    expect(
      compareVersions(v('1.0.0-alpha.1'), v('1.0.0-alpha.beta')),
    ).toBeLessThan(0);
    expect(compareVersions(v('1.0.0+build.5'), v('1.0.0'))).toBe(0);
  });
});

describe('readConfig', () => {
  const dev = {
    ENV_NAME: 'dev',
    API_URL: 'http://localhost:3000',
    API_URL_ANDROID: 'http://10.0.2.2:3000',
  };

  it('uses the Android override on Android and API_URL on iOS', () => {
    expect(readConfig(dev, 'android')).toEqual({
      envName: 'dev',
      apiUrl: 'http://10.0.2.2:3000',
    });
    expect(readConfig(dev, 'ios')).toEqual({
      envName: 'dev',
      apiUrl: 'http://localhost:3000',
    });
  });

  it('uses the iOS override when set', () => {
    expect(
      readConfig({ ...dev, API_URL_IOS: 'http://127.0.0.1:3000' }, 'ios')
        .apiUrl,
    ).toBe('http://127.0.0.1:3000');
  });

  it('strips a trailing slash', () => {
    expect(
      readConfig(
        { ENV_NAME: 'prod', API_URL: 'https://api.example.com/' },
        'ios',
      ).apiUrl,
    ).toBe('https://api.example.com');
  });

  it('refuses a build with no env file', () => {
    expect(() => readConfig({}, 'ios')).toThrow(ConfigError);
    expect(() =>
      readConfig({ ENV_NAME: 'staging', API_URL: 'https://x.example' }, 'ios'),
    ).toThrow(/ENV_NAME/);
    expect(() =>
      readConfig({ ENV_NAME: 'dev', API_URL: 'localhost:3000' }, 'ios'),
    ).toThrow(/API_URL/);
    expect(() =>
      readConfig({ ENV_NAME: 'dev', API_URL: 'https://x.example/v1' }, 'ios'),
    ).toThrow(/API_URL/);
  });
});

describe('money', () => {
  it.each([
    [0, '₹0.00'],
    [5, '₹0.05'],
    [50000, '₹500.00'],
    [123456789, '₹12,34,567.89'],
    [-2500, '-₹25.00'],
  ])('formats %d minor units as %s', (minor, text) => {
    expect(formatMinor(minor, 'INR')).toBe(text);
  });

  it('prefixes unknown currencies with their code', () => {
    expect(formatMinor(1999, 'USD')).toBe('USD 19.99');
  });

  it.each([
    ['500', 50000],
    ['99.5', 9950],
    ['99.50', 9950],
    ['1,250.75', 125075],
    ['₹ 10', 1000],
    ['0.01', 1],
    ['0.1', 10],
  ])('parses "%s" as %d minor units', (text, minor) => {
    expect(parseMajorToMinor(text)).toBe(minor);
  });

  it.each(['', '0', '0.00', 'abc', '1.234', '-5', '1e3', '.5'])(
    'rejects "%s"',
    text => {
      expect(parseMajorToMinor(text)).toBeNull();
    },
  );
});

describe('payments', () => {
  it('maps test cards to the mock provider tokens', () => {
    expect(testCardToken('approve')).toBe('tok_visa');
    expect(testCardToken('decline')).toMatch(/^tok_reject/);
    expect(testCardToken('timeout')).toMatch(/^tok_timeout/);
  });

  it('never offers test cards in production', () => {
    expect(testCardsAvailable('prod')).toBe(false);
    expect(testCardsAvailable('dev')).toBe(true);
    expect(testCardsAvailable('uat')).toBe(true);
  });

  it('makes distinct idempotency keys', () => {
    const keys = new Set(
      Array.from({ length: 200 }, () => newIdempotencyKey()),
    );
    expect(keys.size).toBe(200);
    expect(
      newIdempotencyKey(
        () => 0,
        () => 0,
      ),
    ).toBe('topup-0-00000000000000000000000000000000');
  });
});

describe('keychain token store', () => {
  function fakeKeychain() {
    let entry: { username: string; password: string } | null = null;
    const calls: unknown[] = [];
    return {
      calls,
      peek: () => entry,
      keychain: {
        setGenericPassword: jest.fn(
          async (username: string, password: string, options?: unknown) => {
            calls.push(options);
            entry = { username, password };
            return { service: 'x', storage: 'x' } as never;
          },
        ),
        getGenericPassword: jest.fn(async () =>
          entry
            ? ({ ...entry, service: 'x', storage: 'x' } as never)
            : (false as const),
        ),
        resetGenericPassword: jest.fn(async () => {
          entry = null;
          return true;
        }),
      },
    };
  }

  it('round-trips a session and stores it device-only', async () => {
    const fake = fakeKeychain();
    const store = createKeychainTokenStore(fake.keychain, () => 1_000);
    await store.save({ accessToken: 'jwt', expiresAt: 1_000_000 });
    expect(await store.load()).toEqual({
      accessToken: 'jwt',
      expiresAt: 1_000_000,
    });
    expect(fake.calls[0]).toMatchObject({
      service: 'com.demo.wallet.session',
      accessible: 'AccessibleWhenUnlockedThisDeviceOnly',
    });
  });

  it('drops an expired (or about to expire) session', async () => {
    const fake = fakeKeychain();
    const store = createKeychainTokenStore(fake.keychain, () => 1_000_000);
    await store.save({ accessToken: 'jwt', expiresAt: 1_000_000 + 10_000 });
    expect(await store.load()).toBeNull();
    expect(fake.peek()).toBeNull();
  });

  it('treats a corrupt or unreadable entry as signed out', async () => {
    const fake = fakeKeychain();
    const store = createKeychainTokenStore(fake.keychain, () => 0);
    await fake.keychain.setGenericPassword('access-token', 'not json');
    expect(await store.load()).toBeNull();

    fake.keychain.getGenericPassword.mockRejectedValueOnce(
      new Error('key invalidated'),
    );
    expect(await store.load()).toBeNull();
  });
});
