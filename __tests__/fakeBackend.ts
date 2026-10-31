/**
 * An in-memory backend_demo for component tests: the endpoints the app uses, with the
 * same status codes, error shape and mock-provider rules as the real one (README
 * "Mock providers"). Typed from the pinned schema, so it breaks with the contract.
 */
import type { components } from '../src/api/schema';

type S = components['schemas'];

export type FakeBackend = {
  fetch: typeof fetch;
  minAppVersion: string;
  /** Every request, for assertions: method, path, headers. */
  requests: { method: string; path: string; headers: Headers; body: unknown }[];
  /** Makes the next request to this path fail at the network level. */
  failNextRequestTo: (path: string) => void;
  expireAllTokens: () => void;
  users: Map<string, { password: string; user: S['UserResponse'] }>;
  topUps: S['TopUpResponse'][];
  wallet: S['WalletResponse'];
};

export function createFakeBackend({
  minAppVersion = '1.0.0',
} = {}): FakeBackend {
  const users = new Map<
    string,
    { password: string; user: S['UserResponse'] }
  >();
  const tokens = new Map<string, string>(); // token → email
  const kyc = new Map<string, S['KycSubmissionResponse']>();
  const idempotency = new Map<
    string,
    S['TopUpResultResponse'] & { amountMinor: number }
  >();
  const failing = new Set<string>();
  let seq = 0;
  const now = () => new Date(Date.UTC(2026, 9, 31, 10, 0, seq++)).toISOString();
  const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

  const backend: FakeBackend = {
    minAppVersion,
    requests: [],
    users,
    topUps: [],
    wallet: { currency: 'INR', balanceMinor: 0, updatedAt: now() },
    failNextRequestTo: path => failing.add(path),
    expireAllTokens: () => tokens.clear(),
    fetch: async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method;
      const contentType = request.headers.get('content-type') ?? '';
      let body: unknown = null;
      if (contentType.includes('application/json')) body = await request.json();
      else if (contentType.includes('multipart/form-data'))
        body = Object.fromEntries(
          // Node's FormData is iterable; React Native's global typing doesn't say so.
          (await request.formData()) as unknown as Iterable<[string, unknown]>,
        );
      backend.requests.push({ method, path, headers: request.headers, body });

      if (failing.delete(path)) throw new TypeError('Network request failed');

      const json = (status: number, data: unknown) =>
        new Response(JSON.stringify(data), {
          status,
          headers: {
            'content-type': 'application/json',
            'content-length': String(JSON.stringify(data).length),
          },
        });
      const fail = (status: number, code: string, message: string) =>
        json(status, {
          statusCode: status,
          code,
          message,
        } satisfies S['ErrorResponse']);

      if (method === 'GET' && path === '/meta/min-app-version') {
        return json(200, {
          minAppVersion: backend.minAppVersion,
        } satisfies S['MinAppVersionResponse']);
      }
      if (method === 'POST' && path === '/auth/register') {
        const b = body as S['RegisterRequest'];
        if (users.has(b.email))
          return fail(409, 'CONFLICT', 'Email already registered');
        users.set(b.email, {
          password: b.password,
          user: {
            id: id(),
            email: b.email,
            fullName: b.fullName,
            role: 'USER',
            kycStatus: 'NOT_STARTED',
            createdAt: now(),
          },
        });
        return json(201, users.get(b.email)!.user);
      }
      if (method === 'POST' && path === '/auth/login') {
        const b = body as S['LoginRequest'];
        const account = users.get(b.email);
        if (!account || account.password !== b.password)
          return fail(401, 'UNAUTHORIZED', 'Invalid credentials');
        const token = `token-${++seq}`;
        tokens.set(token, b.email);
        return json(200, {
          accessToken: token,
          tokenType: 'Bearer',
          expiresIn: 3600,
        } satisfies S['TokenResponse']);
      }

      const email = tokens.get(
        (request.headers.get('authorization') ?? '').replace(/^Bearer /, ''),
      );
      if (!email) return fail(401, 'UNAUTHORIZED', 'Unauthorized');
      const account = users.get(email)!;

      if (method === 'GET' && path === '/users/me')
        return json(200, account.user);
      if (method === 'GET' && path === '/kyc') {
        const latest = kyc.get(email);
        return latest
          ? json(200, latest)
          : fail(404, 'NOT_FOUND', 'No KYC submission yet');
      }
      if (method === 'POST' && path === '/kyc') {
        const form = body as Record<string, string>;
        if (account.user.kycStatus === 'APPROVED')
          return fail(409, 'CONFLICT', 'KYC is already approved');
        if (!form.document)
          return fail(400, 'VALIDATION', 'document is required');
        const status = form.documentNumber.startsWith('REJECT')
          ? 'REJECTED'
          : form.documentNumber.startsWith('TIMEOUT')
          ? 'TIMED_OUT'
          : 'APPROVED';
        const submission: S['KycSubmissionResponse'] = {
          id: id(),
          documentType:
            form.documentType as S['KycSubmissionResponse']['documentType'],
          documentNumberLast4: form.documentNumber.slice(-4),
          status,
          createdAt: now(),
          decidedAt: now(),
          decisionReason:
            status === 'REJECTED' ? 'Document could not be verified' : null,
        };
        kyc.set(email, submission);
        account.user = { ...account.user, kycStatus: status };
        return json(201, submission);
      }
      if (method === 'GET' && path === '/wallet')
        return json(200, backend.wallet);
      if (method === 'GET' && path === '/wallet/top-ups') {
        const limit = Number(url.searchParams.get('limit') ?? 20);
        return json(200, backend.topUps.slice(0, limit));
      }
      if (method === 'POST' && path === '/wallet/top-ups') {
        if (account.user.kycStatus !== 'APPROVED')
          return fail(403, 'FORBIDDEN', 'KYC not approved');
        const b = body as S['TopUpRequest'];
        const key = request.headers.get('idempotency-key');
        const previous = key ? idempotency.get(key) : undefined;
        if (previous) {
          if (previous.amountMinor !== b.amountMinor)
            return fail(409, 'CONFLICT', 'Idempotency-Key reused');
          return json(200, { topUp: previous.topUp, wallet: previous.wallet });
        }
        const status: S['TopUpResponse']['status'] = b.paymentToken.startsWith(
          'tok_reject',
        )
          ? 'FAILED'
          : b.paymentToken.startsWith('tok_timeout')
          ? 'TIMED_OUT'
          : 'SUCCEEDED';
        if (status === 'SUCCEEDED') {
          backend.wallet = {
            ...backend.wallet,
            balanceMinor: backend.wallet.balanceMinor + b.amountMinor,
            updatedAt: now(),
          };
        }
        const topUp: S['TopUpResponse'] = {
          id: id(),
          amountMinor: b.amountMinor,
          currency: 'INR',
          status,
          createdAt: now(),
          completedAt: now(),
          failureReason: status === 'FAILED' ? 'card_declined' : null,
        };
        backend.topUps.unshift(topUp);
        const result = { topUp, wallet: backend.wallet };
        if (key)
          idempotency.set(key, { ...result, amountMinor: b.amountMinor });
        return json(201, result);
      }
      return fail(404, 'NOT_FOUND', `No route ${method} ${path}`);
    },
  };
  return backend;
}
