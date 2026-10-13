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
  /** A note shown after the value, such as the bank of a Sheba number. */
  describe?(value: string): string | undefined;
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

// Sheba (شبا), Iran's IBAN: IR, two check digits and 22 digits, the first three after the check digits naming the
// bank. ISO 13616 check: move the first four characters to the end, letters become numbers (I=18, R=27), and the
// result modulo 97 is 1. Worked digit by digit, as the number is too long for floating point.
export function isSheba(value: string) {
  if (!/^IR\d{24}$/.test(value)) return false;
  const digits = [...(value.slice(4) + value.slice(0, 4))]
    .map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c))
    .join('');
  let rest = 0;
  for (const digit of digits) rest = (rest * 10 + Number(digit)) % 97;
  return rest === 1;
}

function normalizeSheba(text: string) {
  const compact = digitsOnly(text).toUpperCase();
  return /^\d{24}$/.test(compact) ? `IR${compact}` : compact;
}

// Bank codes of Iranian Sheba numbers, from the Central Bank's public list; banks not listed show no name.
export const SHEBA_BANKS: Record<string, string> = {
  '010': 'Central Bank of Iran',
  '011': 'Bank of Industry and Mine',
  '012': 'Bank Mellat',
  '013': 'Refah Bank',
  '014': 'Bank Maskan',
  '015': 'Bank Sepah',
  '016': 'Bank Keshavarzi',
  '017': 'Bank Melli Iran',
  '018': 'Tejarat Bank',
  '019': 'Bank Saderat Iran',
  '020': 'Export Development Bank',
  '021': 'Post Bank',
  '022': 'Tose-e Ta-avon Bank',
  '053': 'Karafarin Bank',
  '054': 'Parsian Bank',
  '055': 'EN Bank',
  '056': 'Saman Bank',
  '057': 'Pasargad Bank',
  '058': 'Sarmayeh Bank',
  '059': 'Sina Bank',
  '061': 'Shahr Bank',
  '062': 'Ayandeh Bank',
  '066': 'Dey Bank',
  '069': 'Iran Zamin Bank',
  '070': 'Resalat Bank',
  '078': 'Middle East Bank',
};

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
  {
    name: 'iranSheba',
    title: 'Sheba number',
    error: '{{field}} is not a valid Sheba number',
    maxLength: 34,
    normalize: normalizeSheba,
    validate: isSheba,
    format: (value) => value.replace(/(.{4})(?=.)/g, '$1 '),
    describe: (value) => SHEBA_BANKS[value.slice(4, 7)],
  },
];

export function getIranianFieldKind(name: string | undefined) {
  return IRANIAN_FIELD_KINDS.find((kind) => kind.name === name);
}
