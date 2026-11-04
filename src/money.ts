/**
 * Money is always an integer number of minor units on the wire (amountMinor: 50000 = ₹500.00).
 * These helpers convert at the UI boundary only, with string arithmetic, so no float ever
 * touches an amount.
 */

const SYMBOLS: Record<string, string> = { INR: '₹' };

/** Indian digit grouping: 1,00,00,000. */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}

export function formatMinor(amountMinor: number, currency: string): string {
  const sign = amountMinor < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(amountMinor)).toString().padStart(3, '0');
  const major = abs.slice(0, -2);
  const minor = abs.slice(-2);
  const symbol = SYMBOLS[currency] ?? `${currency} `;
  return `${sign}${symbol}${groupIndian(major)}.${minor}`;
}

/**
 * Parses what the user typed ("500", "1,250.5", "₹99.99") into minor units.
 * Returns null for anything that isn't a positive amount with at most two decimals.
 */
export function parseMajorToMinor(input: string): number | null {
  const cleaned = input.replace(/[₹,\s]/g, '');
  const m = /^(\d{1,9})(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!m) return null;
  const minor = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return minor > 0 ? minor : null;
}
