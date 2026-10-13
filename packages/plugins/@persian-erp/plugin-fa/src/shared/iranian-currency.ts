// Amounts are stored in rials, the legal unit, as whole numbers (bigInt). Most people think in tomans, ten rials, so a
// field can show and take tomans instead (STORY-054).

export type CurrencyUnit = 'rial' | 'toman';

export const RIALS_PER_TOMAN = 10;

const isEmpty = (value: unknown) => value === null || value === undefined || value === '';

/** A stored rial amount (number, or string for bigInt) in the field's unit. */
export function rialToUnit(rial: unknown, unit: CurrencyUnit = 'rial'): number | null {
  if (isEmpty(rial)) return null;
  const amount = Number(rial);
  if (Number.isNaN(amount)) return null;
  return unit === 'toman' ? amount / RIALS_PER_TOMAN : amount;
}

/** An amount typed in the field's unit, as the whole rials to store. */
export function unitToRial(amount: unknown, unit: CurrencyUnit = 'rial'): number | null {
  if (isEmpty(amount)) return null;
  const value = Number(amount);
  if (Number.isNaN(value)) return null;
  return Math.round(unit === 'toman' ? value * RIALS_PER_TOMAN : value);
}

/** "12,500" for 125000 rials in tomans; a toman amount keeps its tenth ("12,500.5"). */
export function formatAmount(rial: unknown, unit: CurrencyUnit = 'rial'): string {
  const amount = rialToUnit(rial, unit);
  if (amount === null) return '';
  return amount.toLocaleString('en-US', { maximumFractionDigits: unit === 'toman' ? 1 : 0 });
}
