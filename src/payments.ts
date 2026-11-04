/**
 * Where the payment token for a top-up comes from.
 *
 * In a real app a payment SDK collects the card and returns a single-use token. backend_demo
 * only has a mock payment provider so far, which picks the outcome from the token's prefix
 * (README "Mock providers"): tok_reject… is declined, tok_timeout… never answers, anything
 * else is approved. Non-production builds offer those three as test cards. Production has no
 * payment SDK yet, so top-up is unavailable there rather than sending a fake token.
 */
import type { EnvName } from './config';

export const TEST_CARDS = [
  { outcome: 'approve', label: 'Test card: approved', token: 'tok_visa' },
  {
    outcome: 'decline',
    label: 'Test card: declined',
    token: 'tok_reject_card',
  },
  {
    outcome: 'timeout',
    label: 'Test card: no answer',
    token: 'tok_timeout_card',
  },
] as const;
export type TestCardOutcome = (typeof TEST_CARDS)[number]['outcome'];

export function testCardsAvailable(envName: EnvName): boolean {
  return envName !== 'prod';
}

export function testCardToken(outcome: TestCardOutcome): string {
  return TEST_CARDS.find(card => card.outcome === outcome)!.token;
}

/**
 * A new Idempotency-Key for one top-up attempt. It only needs to be unique per user, not
 * secret; Hermes has no crypto.getRandomValues without a native module, so time plus
 * Math.random is used.
 */
export function newIdempotencyKey(
  now: () => number = Date.now,
  random: () => number = Math.random,
): string {
  const rand = Array.from({ length: 4 }, () =>
    Math.floor(random() * 0x100000000)
      .toString(16)
      .padStart(8, '0'),
  ).join('');
  return `topup-${now().toString(36)}-${rand}`;
}
