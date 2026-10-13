import { toLatinDigits } from './latin-digits';

// Iranian identifiers as field types (EPIC-013). Each kind has one rule, used by the server before saving and by the
// client in forms: normalize() turns what people type into the stored form, and validate() checks the stored form.

export interface IranianFieldKind {
  /** The field interface name. */
  name: string;
  /** English title, also the translation key. */
  title: string;
  /** The validation message, also the translation key; {{field}} is the field's title. */
  error: string;
  /** Characters a person may type; the input is limited to this length. */
  maxLength: number;
  normalize(text: string): string;
  validate(value: string): boolean;
  /** How a stored value is shown; the stored value itself by default. */
  format?(value: string): string;
}

const digitsOnly = (text: string) => toLatinDigits(text).replace(/[\s\-_.‌/]/g, '');

// Personal national ID (کد ملی): ten digits, the last a check digit over the first nine weighted 10 to 2.
export function isNationalId(value: string) {
  if (!/^\d{10}$/.test(value) || /^(\d)\1{9}$/.test(value)) return false;
  const sum = [...value.slice(0, 9)].reduce((total, digit, i) => total + Number(digit) * (10 - i), 0);
  const rest = sum % 11;
  return Number(value[9]) === (rest < 2 ? rest : 11 - rest);
}

// Legal entity national ID (شناسه‌ی ملی): eleven digits; the tenth digit plus two is added to each of the first ten
// before weighting, and the check digit is the remainder by 11 (10 counts as 0).
const LEGAL_ID_WEIGHTS = [29, 27, 23, 19, 17, 29, 27, 23, 19, 17];
export function isLegalId(value: string) {
  if (!/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) return false;
  const shift = Number(value[9]) + 2;
  const sum = LEGAL_ID_WEIGHTS.reduce((total, weight, i) => total + (Number(value[i]) + shift) * weight, 0);
  return Number(value[10]) === (sum % 11) % 10;
}

export const IRANIAN_FIELD_KINDS: IranianFieldKind[] = [
  {
    name: 'iranNationalId',
    title: 'National ID',
    error: '{{field}} is not a valid national ID',
    maxLength: 12,
    normalize: digitsOnly,
    validate: isNationalId,
  },
  {
    name: 'iranLegalId',
    title: 'Legal entity ID',
    error: '{{field}} is not a valid legal entity ID',
    maxLength: 13,
    normalize: digitsOnly,
    validate: isLegalId,
  },
];

export function getIranianFieldKind(name: string | undefined) {
  return IRANIAN_FIELD_KINDS.find((kind) => kind.name === name);
}
