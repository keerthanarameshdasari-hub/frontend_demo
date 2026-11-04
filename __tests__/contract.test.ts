/**
 * Contract test against a real backend_demo, through the app's own API client.
 * Skipped unless CONTRACT_API_URL is set:
 *
 *   (in backend_demo)  docker compose up --build
 *   (here)             CONTRACT_API_URL=http://localhost:3000 npm run test:contract
 *
 * It walks the same journey as the app (version check, register, sign in, KYC upload,
 * top-ups) with a fresh user each run, so it can point at any non-production backend
 * that uses the mock payment and KYC providers.
 */
import {
  ApiError,
  createApiClient,
  latestKyc,
  submitKyc,
  unwrap,
  type UploadFile,
} from '../src/api/client';
import { isUpdateRequired } from '../src/appVersion';

const baseUrl = process.env.CONTRACT_API_URL;
const suite = baseUrl ? describe : describe.skip;

// The smallest valid PNG (1×1, transparent): the backend checks the bytes match the declared type.
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  ),
  c => c.charCodeAt(0),
);

suite(`backend contract at ${baseUrl}`, () => {
  let token: string | null = null;
  let unauthorized = 0;
  const api = createApiClient({
    baseUrl: baseUrl ?? 'http://unused',
    getToken: () => token,
    onUnauthorized: () => {
      unauthorized++;
    },
  });
  const email = `contract-${Date.now()}-${Math.floor(
    Math.random() * 1e6,
  )}@example.com`;
  const password = 'correct-horse-battery';

  it('serves a semver minimum app version that this build satisfies', async () => {
    const { minAppVersion } = unwrap(await api.GET('/meta/min-app-version'));
    expect(minAppVersion).toMatch(/^\d+\.\d+\.\d+/);
    const appVersion = require('../package.json').version as string;
    expect(isUpdateRequired(appVersion, minAppVersion)).toBe(false);
  });

  it('registers and signs in', async () => {
    unwrap(
      await api.POST('/auth/register', {
        body: { email, password, fullName: 'Contract Test' },
      }),
    );
    const login = unwrap(
      await api.POST('/auth/login', { body: { email, password } }),
    );
    expect(login.tokenType).toBe('Bearer');
    expect(login.expiresIn).toBeGreaterThan(0);
    token = login.accessToken;

    const me = unwrap(await api.GET('/users/me'));
    expect(me).toMatchObject({ email, kycStatus: 'NOT_STARTED', role: 'USER' });
  });

  it('rejects a wrong password with 401', async () => {
    const result = await api.POST('/auth/login', {
      body: { email, password: 'wrong-password-123' },
    });
    expect(result.response.status).toBe(401);
    // A wrong password is not an expired session, even while signed in.
    expect(unauthorized).toBe(0);
  });

  it('refuses a top-up before KYC (403)', async () => {
    await expect(
      api
        .POST('/wallet/top-ups', {
          body: { amountMinor: 1000, paymentToken: 'tok_visa' },
        })
        .then(unwrap),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('has no KYC submission yet (404 → null)', async () => {
    expect(await latestKyc(api)).toBeNull();
  });

  it('uploads a KYC document as multipart and gets it approved', async () => {
    // In the app, `document` is React Native's { uri, name, type } descriptor; under Node a
    // File stands in for it. Both go through submitKyc's FormData unchanged.
    const document = new File([PNG], 'passport.png', {
      type: 'image/png',
    }) as unknown as UploadFile;
    const submission = await submitKyc(api, {
      documentType: 'PASSPORT',
      documentNumber: 'P1234567',
      document,
    });
    expect(submission).toMatchObject({
      status: 'APPROVED',
      documentType: 'PASSPORT',
      documentNumberLast4: '4567',
    });
    expect((await latestKyc(api))?.status).toBe('APPROVED');
    expect(unwrap(await api.GET('/users/me')).kycStatus).toBe('APPROVED');
  });

  it('tops up, and replays (not repeats) a retried Idempotency-Key', async () => {
    const before = unwrap(await api.GET('/wallet'));
    const key = `contract-${Date.now()}`;
    const send = () =>
      api.POST('/wallet/top-ups', {
        params: { header: { 'Idempotency-Key': key } },
        body: { amountMinor: 50000, paymentToken: 'tok_visa' },
      });

    const first = await send();
    expect(first.response.status).toBe(201);
    expect(unwrap(first).topUp.status).toBe('SUCCEEDED');
    expect(unwrap(first).wallet.balanceMinor).toBe(before.balanceMinor + 50000);

    const replay = await send();
    expect(replay.response.status).toBe(200);
    expect(unwrap(replay).topUp.id).toBe(unwrap(first).topUp.id);
    expect(unwrap(await api.GET('/wallet')).balanceMinor).toBe(
      before.balanceMinor + 50000,
    );

    const list = unwrap(
      await api.GET('/wallet/top-ups', { params: { query: { limit: 10 } } }),
    );
    expect(list[0].id).toBe(unwrap(first).topUp.id);
  });

  it('records a declined card as FAILED without crediting', async () => {
    const before = unwrap(await api.GET('/wallet'));
    const result = unwrap(
      await api.POST('/wallet/top-ups', {
        body: { amountMinor: 1000, paymentToken: 'tok_reject_card' },
      }),
    );
    expect(result.topUp.status).toBe('FAILED');
    expect(result.wallet.balanceMinor).toBe(before.balanceMinor);
  });

  it('calls onUnauthorized when the token is refused', async () => {
    token = 'not-a-real-token';
    const result = await api.GET('/users/me');
    expect(result.response.status).toBe(401);
    expect(unauthorized).toBe(1);
    expect(() => unwrap(result)).toThrow(ApiError);
  });
});
