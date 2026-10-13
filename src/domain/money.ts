/**
 * Money helpers. Integer cents only — no floating point arithmetic anywhere in
 * Rydr. Currency is SGD for the MVP.
 */

export function formatSgd(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new Error(`Money must be integer cents, received ${cents}`);
  }
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}SGD ${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function sumCents(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function capCents(value: number, cap: number): number {
  return Math.min(Math.max(value, 0), Math.max(cap, 0));
}

/** Converts a supplied decimal currency amount (e.g. 5.0) to integer cents. */
export function decimalToCents(amount: number): number {
  return Math.round(amount * 100);
}
