/**
 * Typed client for backend_demo. Every path, parameter and body type comes from
 * schema.d.ts, which is generated from the pinned api/openapi.json (see
 * api/openapi.lock.json), so a field the backend renames or removes becomes a
 * compile error here.
 */
import createClient, { type Middleware } from 'openapi-fetch';
import type { components, paths } from './schema';

export type Schemas = components['schemas'];
export type ApiClient = ReturnType<typeof createClient<paths>>;

export type User = Schemas['UserResponse'];
export type KycStatus = User['kycStatus'];
export type KycSubmission = Schemas['KycSubmissionResponse'];
export type DocumentType = KycSubmission['documentType'];
export type Wallet = Schemas['WalletResponse'];
export type TopUp = Schemas['TopUpResponse'];

/** Runtime list for the document type picker; `satisfies` fails to compile if the API changes the set. */
export const DOCUMENT_TYPES = [
  'PASSPORT',
  'NATIONAL_ID',
  'DRIVING_LICENCE',
] as const satisfies readonly DocumentType[];
type Exhaustive<All, Listed> = [Exclude<All, Listed>] extends [never]
  ? true
  : never;
// Fails to compile if the API adds a document type that DOCUMENT_TYPES doesn't list.
true satisfies Exhaustive<DocumentType, (typeof DOCUMENT_TYPES)[number]>;

/** An error response from the API, in its `{ statusCode, code, message }` shape. */
export class ApiError extends Error {
  override name = 'ApiError';
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** The request never got an HTTP response: offline, server down, wrong URL, or timed out. */
export class NetworkError extends Error {
  override name = 'NetworkError';
}

/** Turns an openapi-fetch result into data, or throws ApiError. */
export function unwrap<T>(result: {
  data?: T;
  error?: unknown;
  response: Response;
}): T {
  if (result.data !== undefined && result.response.ok) return result.data;
  const body = (result.error ?? {}) as Partial<Schemas['ErrorResponse']>;
  throw new ApiError(
    result.response.status,
    typeof body.code === 'string' ? body.code : 'ERROR',
    typeof body.message === 'string' && body.message
      ? body.message
      : `Request failed (HTTP ${result.response.status})`,
  );
}

export type ClientOptions = {
  baseUrl: string;
  /** Current access token, or null when signed out. */
  getToken: () => string | null;
  /** Called when an authenticated request gets 401: the token expired or was revoked. */
  onUnauthorized: () => void;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const DEFAULT_TIMEOUT_MS = 20_000;

/** Endpoints that take no bearer token. The type check keeps them real paths of the API. */
const PUBLIC_PATHS: ReadonlySet<string> = new Set<keyof paths>([
  '/auth/login',
  '/auth/register',
  '/meta/min-app-version',
  '/health',
  '/ready',
]);

/** fetch with a deadline. React Native's fetch has none, so a dead server would hang forever. */
function withTimeout(
  fetchImpl: () => typeof fetch,
  timeoutMs: number,
): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl()(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new NetworkError(
        controller.signal.aborted
          ? 'The server took too long to answer. Check your connection and try again.'
          : "Couldn't reach the server. Check your connection and try again.",
      );
    } finally {
      clearTimeout(timer);
    }
  };
}

export function createApiClient(options: ClientOptions): ApiClient {
  const client = createClient<paths>({
    baseUrl: options.baseUrl,
    // Resolve fetch at call time (not import time) so test doubles installed later are used.
    fetch: withTimeout(
      () => options.fetchImpl ?? globalThis.fetch,
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ),
  });

  const auth: Middleware = {
    onRequest({ request, schemaPath }) {
      const token = options.getToken();
      if (token && !PUBLIC_PATHS.has(schemaPath)) {
        request.headers.set('Authorization', `Bearer ${token}`);
      }
      return request;
    },
    onResponse({ request, response, schemaPath }) {
      // A 401 from /auth/login is a wrong password, not an expired session.
      if (
        response.status === 401 &&
        !PUBLIC_PATHS.has(schemaPath) &&
        request.headers.has('Authorization')
      ) {
        options.onUnauthorized();
      }
      return response;
    },
  };
  client.use(auth);
  return client;
}

/** A file picked on the device, in the shape React Native's FormData uploads from. */
export type UploadFile = { uri: string; name: string; type: string };

/**
 * POST /kyc (multipart). openapi-fetch types the `document` field as a string
 * (OpenAPI's `format: binary`); React Native uploads a file from a `{ uri, name, type }`
 * object instead, so the form is built here.
 */
export async function submitKyc(
  api: ApiClient,
  form: {
    documentType: DocumentType;
    documentNumber: string;
    document: UploadFile;
  },
): Promise<KycSubmission> {
  return unwrap(
    await api.POST('/kyc', {
      body: {
        documentType: form.documentType,
        documentNumber: form.documentNumber,
        document: '',
      },
      bodySerializer: () => {
        const data = new FormData();
        data.append('documentType', form.documentType);
        data.append('documentNumber', form.documentNumber);
        // React Native's FormData accepts a file descriptor object; the DOM typings don't know that.
        data.append('document', form.document as unknown as Blob);
        return data;
      },
    }),
  );
}

/** GET /kyc, where 404 means "never submitted" rather than an error. */
export async function latestKyc(api: ApiClient): Promise<KycSubmission | null> {
  const result = await api.GET('/kyc');
  if (result.response.status === 404) return null;
  return unwrap(result);
}
