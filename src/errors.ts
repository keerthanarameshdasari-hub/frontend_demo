import { ApiError, NetworkError } from './api/client';

/** A message fit to show the user for anything a screen's action threw. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError || error instanceof NetworkError)
    return error.message;
  return 'Something went wrong. Please try again.';
}
